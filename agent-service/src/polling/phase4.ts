import type { ReplyGenerator } from "../llm/replyGenerator.js";
import { findLatestIncomingMessage } from "../processing/detectIncoming.js";
import type { ContactPolicy } from "../policy/contactPolicy.js";
import type { ProcessedMessageRepository } from "../store/processedMessageRepository.js";
import type { Conversation, ReadMessagesResult } from "../types/douyin.js";
import { createMessageKey } from "../utils/messageKey.js";

export type Phase4DouyinClient = {
  listConversations(): Promise<Conversation[]>;
  readMessages(contact: string, limit: number): Promise<ReadMessagesResult>;
};

export type Phase4Summary = {
  conversations: number;
  policySkipped: number;
  incomingFound: number;
  alreadyProcessed: number;
  repliesGenerated: number;
  replySkipped: number;
  failed: number;
};

export async function runPhase4Scan(
  client: Phase4DouyinClient,
  repository: ProcessedMessageRepository,
  policy: ContactPolicy,
  generator: ReplyGenerator,
  messageLimit: number,
): Promise<Phase4Summary> {
  const conversations = await client.listConversations();
  const ordered = [...conversations].sort(
    (left, right) => Number(right.unread) - Number(left.unread),
  );
  const summary: Phase4Summary = {
    conversations: conversations.length,
    policySkipped: 0,
    incomingFound: 0,
    alreadyProcessed: 0,
    repliesGenerated: 0,
    replySkipped: 0,
    failed: 0,
  };

  console.log(`Conversations found: ${conversations.length}`);
  console.log("Scanning eligible conversations; unread only affects priority.");

  for (const conversation of ordered) {
    if (!policy.decide(conversation.nickname).allowed) {
      summary.policySkipped += 1;
      continue;
    }

    try {
      const result = await client.readMessages(
        conversation.nickname,
        messageLimit,
      );
      const incoming = findLatestIncomingMessage(result.messages);
      if (!incoming) {
        summary.replySkipped += 1;
        console.log(`[message skipped] ${conversation.nickname}: no new incoming message`);
        continue;
      }

      summary.incomingFound += 1;
      const messageKey = createMessageKey(conversation.conversation_id, incoming);
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
          disposition: "phase4_skipped",
        });
        summary.replySkipped += 1;
        console.log(`[message skipped] ${conversation.nickname}: unsupported message type`);
        continue;
      }

      const generation = await generator.generate(result.messages);
      if (!generation.shouldReply) {
        repository.markProcessed({
          conversationId: conversation.conversation_id,
          messageKey,
          message: incoming,
          disposition: "phase4_skipped",
        });
        summary.replySkipped += 1;
        console.log(`[message skipped] ${conversation.nickname}: ${generation.reason}`);
        continue;
      }

      const inserted = repository.markProcessed({
        conversationId: conversation.conversation_id,
        messageKey,
        message: incoming,
        disposition: "phase4_dry_run",
        replyContent: generation.replyText,
      });
      if (!inserted) {
        summary.alreadyProcessed += 1;
        console.log(`[message already processed] ${conversation.nickname}`);
        continue;
      }

      summary.repliesGenerated += 1;
      console.log(
        `\n[DRY RUN]\n好友：${conversation.nickname}\n收到：\n${incoming.content}\n\n准备回复：\n${generation.replyText}\n`,
      );
    } catch (error) {
      summary.failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[failed] ${conversation.nickname}: ${detail}`);
    }
  }

  return summary;
}
