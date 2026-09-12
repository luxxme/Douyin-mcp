import type {
  Conversation,
  DouyinMessage,
  ReadMessagesResult,
} from "../types/douyin.js";

export type Phase2DouyinClient = {
  listConversations(): Promise<Conversation[]>;
  readMessages(contact: string, limit: number): Promise<ReadMessagesResult>;
};

function messageLine(message: DouyinMessage): string {
  const time = message.timestamp ?? "时间未知";
  return `  [${time}] [${message.type}] ${message.sender}: ${message.content}`;
}

export async function runPhase2Scan(
  client: Phase2DouyinClient,
  messageLimit: number,
): Promise<void> {
  console.log("Phase 2 scan started");

  const conversations = await client.listConversations();
  console.log(`Conversations found: ${conversations.length}`);

  const candidates = conversations.filter(
    (conversation: Conversation) => conversation.unread,
  );
  console.log(`Unread candidates: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log("No unread conversations. Nothing to read.");
    return;
  }

  for (const conversation of candidates) {
    try {
      console.log(
        `\nConversation: ${conversation.nickname} (unread=${conversation.unread_count})`,
      );
      const result = await client.readMessages(
        conversation.nickname,
        messageLimit,
      );
      console.log(`Recent messages: ${result.count}`);
      for (const message of result.messages) {
        console.log(messageLine(message));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `Failed to read conversation ${conversation.nickname}: ${detail}`,
      );
    }
  }
}
