import type { ReplyGenerator } from "../llm/replyGenerator.js";
import { findLatestIncomingMessage } from "../processing/detectIncoming.js";
import type { ContactPolicy } from "../policy/contactPolicy.js";
import type { ReplyRateLimiter } from "../safety/rateLimiter.js";
import type { ProcessedMessageRepository } from "../store/processedMessageRepository.js";
import type {
  Conversation,
  ReadMessagesResult,
  SendMessageResult,
} from "../types/douyin.js";
import { createMessageKey } from "../utils/messageKey.js";

export type Phase5DouyinClient = {
  listConversations(): Promise<Conversation[]>;
  readMessages(contact: string, limit: number): Promise<ReadMessagesResult>;
  sendMessage(contact: string, text: string): Promise<SendMessageResult>;
};

export type Phase5Summary = {
  conversations: number;
  policySkipped: number;
  incomingFound: number;
  alreadyProcessed: number;
  repliesGenerated: number;
  dryRuns: number;
  sent: number;
  rateLimited: number;
  replySkipped: number;
  sendUncertain: number;
  failed: number;
  loginExpired: boolean;
};

export function isLoginExpiredError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /login|登录|扫码|cookie|session\s*expired/i.test(detail);
}

export async function runPhase5Scan(
  client: Phase5DouyinClient,
  repository: ProcessedMessageRepository,
  policy: ContactPolicy,
  generator: ReplyGenerator,
  rateLimiter: ReplyRateLimiter,
  options: { messageLimit: number; sendEnabled: boolean },
): Promise<Phase5Summary> {
  const summary: Phase5Summary = {
    conversations: 0,
    policySkipped: 0,
    incomingFound: 0,
    alreadyProcessed: 0,
    repliesGenerated: 0,
    dryRuns: 0,
    sent: 0,
    rateLimited: 0,
    replySkipped: 0,
    sendUncertain: 0,
    failed: 0,
    loginExpired: false,
  };

  let conversations: Conversation[];
  try {
    conversations = await client.listConversations();
  } catch (error) {
    if (isLoginExpiredError(error)) {
      summary.loginExpired = true;
      console.error("Douyin login session expired. Please re-login. Auto reply paused.");
      return summary;
    }
    throw error;
  }

  summary.conversations = conversations.length;
  const ordered = [...conversations].sort(
    (left, right) => Number(right.unread) - Number(left.unread),
  );
  console.log(`Conversations found: ${conversations.length}`);
  console.log("Scanning eligible conversations; unread only affects priority.");

  for (const conversation of ordered) {
    if (!policy.decide(conversation.nickname).allowed) {
      summary.policySkipped += 1;
      continue;
    }

    let messageKey: string | undefined;
    let reserved = false;
    try {
      const result = await client.readMessages(
        conversation.nickname,
        options.messageLimit,
      );
      const incoming = findLatestIncomingMessage(result.messages);
      if (!incoming) {
        summary.replySkipped += 1;
        console.log(`[message skipped] ${conversation.nickname}: no new incoming message`);
        continue;
      }

      summary.incomingFound += 1;
      messageKey = createMessageKey(conversation.conversation_id, incoming);
      if (repository.isProcessed(conversation.conversation_id, messageKey)) {
        summary.alreadyProcessed += 1;
        console.log(`[message already processed] ${conversation.nickname}`);
        continue;
      }

      if (incoming.type !== "text") {
        repository.markProcessed({
          conversationId: conversation.conversation_id,
          messageKey,
          message: incoming,
          disposition: "phase5_skipped",
        });
        summary.replySkipped += 1;
        console.log(`[message skipped] ${conversation.nickname}: unsupported message type`);
        continue;
      }

      const generation = await generator.generate(result.messages);
      if (!generation.shouldReply || generation.replyText.length > 500) {
        repository.markProcessed({
          conversationId: conversation.conversation_id,
          messageKey,
          message: incoming,
          disposition: "phase5_skipped",
        });
        summary.replySkipped += 1;
        const reason = generation.shouldReply ? "reply_too_long" : generation.reason;
        console.log(`[message skipped] ${conversation.nickname}: ${reason}`);
        continue;
      }
      summary.repliesGenerated += 1;

      if (!options.sendEnabled) {
        repository.markProcessed({
          conversationId: conversation.conversation_id,
          messageKey,
          message: incoming,
          disposition: "phase5_dry_run",
          replyContent: generation.replyText,
        });
        summary.dryRuns += 1;
        console.log(
          `\n[DRY RUN]\n好友：${conversation.nickname}\n收到：\n${incoming.content}\n\n准备回复：\n${generation.replyText}\n`,
        );
        continue;
      }

      const rateDecision = rateLimiter.check(conversation.conversation_id);
      if (!rateDecision.allowed) {
        repository.markProcessed({
          conversationId: conversation.conversation_id,
          messageKey,
          message: incoming,
          disposition: "phase5_skipped_rate_limit",
          replyContent: generation.replyText,
        });
        summary.rateLimited += 1;
        console.warn(`[rate limited] ${conversation.nickname}: ${rateDecision.reason}`);
        continue;
      }

      reserved = repository.markProcessed({
        conversationId: conversation.conversation_id,
        messageKey,
        message: incoming,
        disposition: "phase5_sending",
        replyContent: generation.replyText,
      });
      if (!reserved) {
        summary.alreadyProcessed += 1;
        console.log(`[message already processed] ${conversation.nickname}`);
        continue;
      }

      const sendResult = await client.sendMessage(
        conversation.nickname,
        generation.replyText,
      );
      if (sendResult.ok && sendResult.status === "sent") {
        repository.updateDisposition(
          conversation.conversation_id,
          messageKey,
          "phase5_sending",
          "phase5_sent",
        );
        summary.sent += 1;
        console.log(`[reply sent] ${conversation.nickname}`);
      } else if (sendResult.status === "failed") {
        repository.releaseReservation(conversation.conversation_id, messageKey);
        reserved = false;
        summary.failed += 1;
        console.error(`[send failed] ${conversation.nickname}: ${sendResult.detail}`);
      } else {
        repository.updateDisposition(
          conversation.conversation_id,
          messageKey,
          "phase5_sending",
          "phase5_send_uncertain",
        );
        summary.sendUncertain += 1;
        console.error(
          `[send uncertain] ${conversation.nickname}: ${sendResult.detail}; automatic retry disabled`,
        );
      }
    } catch (error) {
      if (reserved && messageKey) {
        repository.updateDisposition(
          conversation.conversation_id,
          messageKey,
          "phase5_sending",
          "phase5_send_uncertain",
        );
        summary.sendUncertain += 1;
      }
      if (isLoginExpiredError(error)) {
        summary.loginExpired = true;
        console.error("Douyin login session expired. Please re-login. Auto reply paused.");
        break;
      }
      summary.failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[failed] ${conversation.nickname}: ${detail}`);
    }
  }

  return summary;
}
