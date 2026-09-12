import type { Conversation, ReadMessagesResult } from "../types/douyin.js";
import { findLatestIncomingMessage } from "../processing/detectIncoming.js";
import type { ProcessedMessageRepository } from "../store/processedMessageRepository.js";
import { createMessageKey } from "../utils/messageKey.js";

export type Phase3DouyinClient = {
  listConversations(): Promise<Conversation[]>;
  readMessages(contact: string, limit: number): Promise<ReadMessagesResult>;
};

export type Phase3Summary = {
  conversations: number;
  incomingFound: number;
  newlyProcessed: number;
  alreadyProcessed: number;
  skipped: number;
  failed: number;
};

export async function runPhase3Scan(
  client: Phase3DouyinClient,
  repository: ProcessedMessageRepository,
  messageLimit: number,
): Promise<Phase3Summary> {
  const conversations = await client.listConversations();
  const ordered = [...conversations].sort(
    (left, right) => Number(right.unread) - Number(left.unread),
  );
  const summary: Phase3Summary = {
    conversations: conversations.length,
    incomingFound: 0,
    newlyProcessed: 0,
    alreadyProcessed: 0,
    skipped: 0,
    failed: 0,
  };

  console.log(`Conversations found: ${conversations.length}`);
  console.log("Scanning all conversations; unread only affects priority.");

  for (const conversation of ordered) {
    try {
      const result = await client.readMessages(
        conversation.nickname,
        messageLimit,
      );
      const incoming = findLatestIncomingMessage(result.messages);
      if (!incoming) {
        summary.skipped += 1;
        console.log(`[skipped] ${conversation.nickname}: no incoming message`);
        continue;
      }

      summary.incomingFound += 1;
      const messageKey = createMessageKey(conversation.conversation_id, incoming);
      if (repository.isProcessed(conversation.conversation_id, messageKey)) {
        summary.alreadyProcessed += 1;
        console.log(`[already processed] ${conversation.nickname}: ${messageKey}`);
        continue;
      }

      const inserted = repository.markProcessed({
        conversationId: conversation.conversation_id,
        messageKey,
        message: incoming,
        disposition: "phase3_observed",
      });

      if (inserted) {
        summary.newlyProcessed += 1;
        console.log(`[new incoming] ${conversation.nickname}: ${messageKey}`);
      } else {
        summary.alreadyProcessed += 1;
        console.log(`[already processed] ${conversation.nickname}: ${messageKey}`);
      }
    } catch (error) {
      summary.failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[failed] ${conversation.nickname}: ${detail}`);
    }
  }

  return summary;
}
