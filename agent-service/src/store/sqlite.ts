import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openAgentDatabase(configuredPath: string): DatabaseSync {
  const databasePath =
    configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      id INTEGER PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_key TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      message_timestamp TEXT,
      message_type TEXT NOT NULL,
      disposition TEXT NOT NULL,
      created_at TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      reply_content TEXT,
      UNIQUE (conversation_id, message_key)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_processed_messages_processed_at
      ON processed_messages (processed_at DESC);
  `);

  return database;
}
