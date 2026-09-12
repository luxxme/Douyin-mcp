import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProcessedMessageRepository } from "../src/store/processedMessageRepository.js";
import { openAgentDatabase } from "../src/store/sqlite.js";

test("inserts the same incoming message only once", () => {
  const database = openAgentDatabase(":memory:");
  try {
    const repository = new ProcessedMessageRepository(database);
    const input = {
      conversationId: "conversation-1",
      messageKey: "message-1",
      message: {
        id: "message-1",
        sender: "friend" as const,
        sender_name: "好友",
        content: "在吗",
        timestamp: "12:30",
        type: "text" as const,
      },
      disposition: "phase3_observed" as const,
      processedAt: "2026-09-12T00:00:00.000Z",
    };

    assert.equal(repository.markProcessed(input), true);
    assert.equal(repository.markProcessed(input), false);
    assert.equal(repository.isProcessed("conversation-1", "message-1"), true);
    assert.equal(repository.count(), 1);
  } finally {
    database.close();
  }
});

test("keeps idempotency state after reopening a file database", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "douyin-agent-test-"));
  const databasePath = join(temporaryDirectory, "state.db");
  const input = {
    conversationId: "conversation-1",
    messageKey: "message-1",
    message: {
      id: "message-1",
      sender: "friend" as const,
      sender_name: "好友",
      content: "在吗",
      timestamp: "12:30",
      type: "text" as const,
    },
    disposition: "phase3_observed" as const,
    processedAt: "2026-09-12T00:00:00.000Z",
  };

  try {
    const firstDatabase = openAgentDatabase(databasePath);
    const firstRepository = new ProcessedMessageRepository(firstDatabase);
    assert.equal(firstRepository.markProcessed(input), true);
    firstDatabase.close();

    const reopenedDatabase = openAgentDatabase(databasePath);
    try {
      const reopenedRepository = new ProcessedMessageRepository(reopenedDatabase);
      assert.equal(
        reopenedRepository.isProcessed("conversation-1", "message-1"),
        true,
      );
      assert.equal(reopenedRepository.markProcessed(input), false);
      assert.equal(reopenedRepository.count(), 1);
    } finally {
      reopenedDatabase.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
