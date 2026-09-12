import {
  END,
  START,
  StateGraph,
  type GraphNode,
} from "@langchain/langgraph";

import type { ReplyGenerator } from "../llm/replyGenerator.js";
import { findTrailingIncomingMessages } from "../processing/detectIncoming.js";
import { isLoginExpiredError } from "../polling/phase5.js";
import type { ReplyRateLimiter } from "../safety/rateLimiter.js";
import type { ProcessedMessageRepository } from "../store/processedMessageRepository.js";
import type { ReadMessagesResult, SendMessageResult } from "../types/douyin.js";
import { createMessageKey } from "../utils/messageKey.js";
import { AutoReplyStateSchema, type AutoReplyState } from "./state.js";

export type GraphDouyinClient = {
  readMessages(contact: string, limit: number): Promise<ReadMessagesResult>;
  sendMessage(contact: string, text: string): Promise<SendMessageResult>;
};

export type AutoReplyGraphDependencies = {
  client: GraphDouyinClient;
  repository: ProcessedMessageRepository;
  generator: ReplyGenerator;
  rateLimiter: ReplyRateLimiter;
  messageLimit: number;
  sendEnabled: boolean;
};

export function createAutoReplyGraph(dependencies: AutoReplyGraphDependencies) {
  const loadMessages: GraphNode<typeof AutoReplyStateSchema> = async (state) => {
    const result = await dependencies.client.readMessages(
      state.conversation.nickname,
      dependencies.messageLimit,
    );
    return { messages: result.messages };
  };

  const detectIncoming: GraphNode<typeof AutoReplyStateSchema> = (state) => {
    const incomingBatch = findTrailingIncomingMessages(state.messages);
    const latestIncomingMessage = incomingBatch.at(-1);
    return {
      incomingBatch,
      ...(latestIncomingMessage ? { latestIncomingMessage } : {}),
      ...(!latestIncomingMessage
        ? { shouldReply: false, reason: "no_new_incoming", outcome: "skipped" as const }
        : {}),
    };
  };

  const checkAlreadyProcessed: GraphNode<typeof AutoReplyStateSchema> = (state) => {
    const incoming = state.latestIncomingMessage;
    if (!incoming) return { alreadyProcessed: false };

    const messageKey = createMessageKey(state.conversation.conversation_id, incoming);
    const messageChangedDuringDebounce = Boolean(
      state.expectedMessageKey && state.expectedMessageKey !== messageKey,
    );
    if (messageChangedDuringDebounce) {
      return {
        messageKey,
        messageChangedDuringDebounce: true,
        shouldReply: false,
        reason: "message_changed_during_debounce",
        outcome: "debounce_reset",
      };
    }

    const alreadyProcessed = dependencies.repository.isProcessed(
      state.conversation.conversation_id,
      messageKey,
    );
    return {
      messageKey,
      alreadyProcessed,
      ...(alreadyProcessed
        ? { shouldReply: false, reason: "already_processed", outcome: "already_processed" as const }
        : {}),
    };
  };

  const routeAfterIdempotency = (
    state: AutoReplyState,
  ): "evaluateShouldReply" | typeof END => {
    if (
      !state.latestIncomingMessage ||
      state.alreadyProcessed ||
      state.messageChangedDuringDebounce
    ) {
      return END;
    }
    return "evaluateShouldReply";
  };

  const shouldReply: GraphNode<typeof AutoReplyStateSchema> = (state) => {
    const incoming = state.latestIncomingMessage;
    if (!incoming || incoming.type !== "text" || !incoming.content.trim()) {
      return {
        shouldReply: false,
        reason: "unsupported_or_empty_message",
      };
    }
    return { shouldReply: true, reason: "eligible_text_message" };
  };

  const routeShouldReply = (
    state: AutoReplyState,
  ): "generateReply" | "markSkipped" =>
    state.shouldReply ? "generateReply" : "markSkipped";

  const generateReply: GraphNode<typeof AutoReplyStateSchema> = async (state) => {
    const generation = await dependencies.generator.generate(state.messages);
    if (!generation.shouldReply) {
      return { shouldReply: false, reason: generation.reason };
    }
    return {
      shouldReply: true,
      replyText: generation.replyText,
      reason: generation.reason,
    };
  };

  const validateReply: GraphNode<typeof AutoReplyStateSchema> = (state) => {
    const replyText = state.replyText?.trim() ?? "";
    if (!state.shouldReply || !replyText || replyText.length > 500) {
      return {
        shouldReply: false,
        reason: replyText.length > 500 ? "reply_too_long" : "empty_or_declined_reply",
      };
    }
    return { shouldReply: true, replyText };
  };

  const routeValidatedReply = (
    state: AutoReplyState,
  ): "deliverReply" | "markSkipped" =>
    state.shouldReply ? "deliverReply" : "markSkipped";

  const markSkipped: GraphNode<typeof AutoReplyStateSchema> = (state) => {
    const incoming = state.latestIncomingMessage;
    if (!incoming || !state.messageKey) return { outcome: "skipped" };
    dependencies.repository.markProcessed({
      conversationId: state.conversation.conversation_id,
      messageKey: state.messageKey,
      message: incoming,
      disposition: "phase6_skipped",
      replyContent: state.replyText ?? null,
    });
    console.log(`[message skipped] ${state.conversation.nickname}: ${state.reason ?? "policy"}`);
    return { outcome: "skipped" };
  };

  const deliverReply: GraphNode<typeof AutoReplyStateSchema> = async (state) => {
    const incoming = state.latestIncomingMessage;
    const messageKey = state.messageKey;
    const replyText = state.replyText;
    if (!incoming || !messageKey || !replyText) {
      return { outcome: "failed", reason: "missing_delivery_state" };
    }

    if (dependencies.sendEnabled) {
      const rateDecision = dependencies.rateLimiter.check(
        state.conversation.conversation_id,
      );
      if (!rateDecision.allowed) {
        dependencies.repository.markProcessed({
          conversationId: state.conversation.conversation_id,
          messageKey,
          message: incoming,
          disposition: "phase6_skipped_rate_limit",
          replyContent: replyText,
        });
        console.warn(
          `[rate limited] ${state.conversation.nickname}: ${rateDecision.reason}`,
        );
        return { outcome: "rate_limited", reason: rateDecision.reason };
      }
    }

    const reserved = dependencies.repository.markProcessed({
      conversationId: state.conversation.conversation_id,
      messageKey,
      message: incoming,
      disposition: "phase6_sending",
      replyContent: replyText,
    });
    if (!reserved) {
      return { outcome: "already_processed", reason: "reservation_conflict" };
    }

    if (!dependencies.sendEnabled) {
      dependencies.repository.updateDisposition(
        state.conversation.conversation_id,
        messageKey,
        "phase6_sending",
        "phase6_dry_run",
      );
      const received = state.incomingBatch.map((message) => message.content).join("\n");
      console.log(
        `\n[DRY RUN]\n好友：${state.conversation.nickname}\n收到：\n${received}\n\n准备回复：\n${replyText}\n`,
      );
      return { outcome: "dry_run" };
    }

    try {
      const result = await dependencies.client.sendMessage(
        state.conversation.nickname,
        replyText,
      );
      if (result.ok && result.status === "sent") {
        dependencies.repository.updateDisposition(
          state.conversation.conversation_id,
          messageKey,
          "phase6_sending",
          "phase6_sent",
        );
        console.log(`[reply sent] ${state.conversation.nickname}`);
        return { outcome: "sent" };
      }
      if (result.status === "failed") {
        dependencies.repository.releasePhase6Reservation(
          state.conversation.conversation_id,
          messageKey,
        );
        console.error(`[send failed] ${state.conversation.nickname}: ${result.detail}`);
        return { outcome: "failed", reason: result.detail };
      }
      dependencies.repository.updateDisposition(
        state.conversation.conversation_id,
        messageKey,
        "phase6_sending",
        "phase6_send_uncertain",
      );
      console.error(
        `[send uncertain] ${state.conversation.nickname}: ${result.detail}; automatic retry disabled`,
      );
      return { outcome: "send_uncertain", reason: result.detail };
    } catch (error) {
      dependencies.repository.updateDisposition(
        state.conversation.conversation_id,
        messageKey,
        "phase6_sending",
        "phase6_send_uncertain",
      );
      if (isLoginExpiredError(error)) {
        return { outcome: "login_expired", reason: "login_expired_during_send" };
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[send uncertain] ${state.conversation.nickname}: ${detail}; automatic retry disabled`,
      );
      return { outcome: "send_uncertain", reason: detail };
    }
  };

  return new StateGraph(AutoReplyStateSchema)
    .addNode("loadMessages", loadMessages)
    .addNode("detectIncoming", detectIncoming)
    .addNode("checkAlreadyProcessed", checkAlreadyProcessed)
    .addNode("evaluateShouldReply", shouldReply)
    .addNode("generateReply", generateReply)
    .addNode("validateReply", validateReply)
    .addNode("markSkipped", markSkipped)
    .addNode("deliverReply", deliverReply)
    .addEdge(START, "loadMessages")
    .addEdge("loadMessages", "detectIncoming")
    .addEdge("detectIncoming", "checkAlreadyProcessed")
    .addConditionalEdges("checkAlreadyProcessed", routeAfterIdempotency, [
      "evaluateShouldReply",
      END,
    ])
    .addConditionalEdges("evaluateShouldReply", routeShouldReply, [
      "generateReply",
      "markSkipped",
    ])
    .addEdge("generateReply", "validateReply")
    .addConditionalEdges("validateReply", routeValidatedReply, [
      "deliverReply",
      "markSkipped",
    ])
    .addEdge("markSkipped", END)
    .addEdge("deliverReply", END)
    .compile();
}

export type AutoReplyGraph = ReturnType<typeof createAutoReplyGraph>;
