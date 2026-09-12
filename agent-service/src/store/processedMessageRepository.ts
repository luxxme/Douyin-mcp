import type { DatabaseSync } from "node:sqlite";

import type { DouyinMessage } from "../types/douyin.js";

export type MarkProcessedInput = {
  conversationId: string;
  messageKey: string;
  message: DouyinMessage;
  disposition:
    | "phase3_observed"
    | "phase4_dry_run"
    | "phase4_skipped"
    | "phase5_dry_run"
    | "phase5_skipped"
    | "phase5_skipped_rate_limit"
    | "phase5_sending"
    | "phase5_sent"
    | "phase5_send_uncertain"
    | "phase6_dry_run"
    | "phase6_skipped"
    | "phase6_skipped_rate_limit"
    | "phase6_sending"
    | "phase6_sent"
    | "phase6_send_uncertain";
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

  updateDisposition(
    conversationId: string,
    messageKey: string,
    from: MarkProcessedInput["disposition"],
    to: MarkProcessedInput["disposition"],
    processedAt = new Date().toISOString(),
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE processed_messages
         SET disposition = ?, processed_at = ?
         WHERE conversation_id = ? AND message_key = ? AND disposition = ?`,
      )
      .run(to, processedAt, conversationId, messageKey, from);
    return Number(result.changes) === 1;
  }

  releaseReservation(conversationId: string, messageKey: string): boolean {
    const result = this.database
      .prepare(
        `DELETE FROM processed_messages
         WHERE conversation_id = ? AND message_key = ?
           AND disposition = 'phase5_sending'`,
      )
      .run(conversationId, messageKey);
    return Number(result.changes) === 1;
  }

  countSendAttemptsSince(since: string, conversationId?: string): number {
    const dispositions =
      "('phase5_sending', 'phase5_sent', 'phase5_send_uncertain', " +
      "'phase6_sending', 'phase6_sent', 'phase6_send_uncertain')";
    const row = conversationId
      ? this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM processed_messages
             WHERE processed_at >= ? AND conversation_id = ?
               AND disposition IN ${dispositions}`,
          )
          .get(since, conversationId)
      : this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM processed_messages
             WHERE processed_at >= ? AND disposition IN ${dispositions}`,
          )
          .get(since);
    return Number((row as { count: number }).count);
  }

  releasePhase6Reservation(conversationId: string, messageKey: string): boolean {
    const result = this.database
      .prepare(
        `DELETE FROM processed_messages
         WHERE conversation_id = ? AND message_key = ?
           AND disposition = 'phase6_sending'`,
      )
      .run(conversationId, messageKey);
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
