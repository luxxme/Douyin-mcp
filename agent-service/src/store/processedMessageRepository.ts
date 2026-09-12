import type { DatabaseSync } from "node:sqlite";

import type { DouyinMessage } from "../types/douyin.js";

export type MarkProcessedInput = {
  conversationId: string;
  messageKey: string;
  message: DouyinMessage;
  disposition: "phase3_observed" | "phase4_dry_run" | "phase4_skipped";
  processedAt?: string;
  replyContent?: string | null;
};

export type ProcessedMessageRow = {
  id: number;
  conversation_id: string;
  message_key: string;
  sender: string;
  content: string;
  message_timestamp: string | null;
  message_type: string;
  disposition: string;
  created_at: string;
  processed_at: string;
  reply_content: string | null;
};

export class ProcessedMessageRepository {
  constructor(private readonly database: DatabaseSync) {}

  isProcessed(conversationId: string, messageKey: string): boolean {
    const row = this.database
      .prepare(
        `SELECT 1
         FROM processed_messages
         WHERE conversation_id = ? AND message_key = ?
         LIMIT 1`,
      )
      .get(conversationId, messageKey);
    return row !== undefined;
  }

  markProcessed(input: MarkProcessedInput): boolean {
    const processedAt = input.processedAt ?? new Date().toISOString();
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO processed_messages (
          conversation_id,
          message_key,
          sender,
          content,
          message_timestamp,
          message_type,
          disposition,
          created_at,
          processed_at,
          reply_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.conversationId,
        input.messageKey,
        input.message.sender,
        input.message.content,
        input.message.timestamp,
        input.message.type,
        input.disposition,
        processedAt,
        processedAt,
        input.replyContent ?? null,
      );

    return Number(result.changes) === 1;
  }

  count(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM processed_messages")
      .get() as { count: number };
    return Number(row.count);
  }

  listRecent(limit = 20): ProcessedMessageRow[] {
    return this.database
      .prepare(
        `SELECT *
         FROM processed_messages
         ORDER BY processed_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as ProcessedMessageRow[];
  }
}
