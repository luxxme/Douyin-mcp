import assert from "node:assert/strict";
import test from "node:test";

import {
  runPhase3Scan,
  type Phase3DouyinClient,
} from "../src/polling/phase3.js";
import { ProcessedMessageRepository } from "../src/store/processedMessageRepository.js";
import { openAgentDatabase } from "../src/store/sqlite.js";

test("processes an incoming message once across repeated scans", async () => {
  const database = openAgentDatabase(":memory:");
  const originalLog = console.log;
  console.log = () => undefined;

  const client: Phase3DouyinClient = {
    async listConversations() {
      return [
        {
          conversation_id: "conversation-1",
          user_id: "user-1",
          nickname: "好友",
          last_message: "在吗",
          unread: false,
          unread_count: 0,
          timestamp: "12:30",
        },
      ];
    },
    async readMessages(contact) {
      return {
        conversation_id: "conversation-1",
        user_id: "user-1",
        nickname: contact,
        messages: [
          {
            id: "message-1",
            sender: "friend",
            sender_name: contact,
            content: "在吗",
            timestamp: "12:30",
            type: "text",
          },
        ],
        count: 1,
      };
    },
  };

  try {
    const repository = new ProcessedMessageRepository(database);
    const first = await runPhase3Scan(client, repository, 20);
    const second = await runPhase3Scan(client, repository, 20);

    assert.equal(first.newlyProcessed, 1);
    assert.equal(first.alreadyProcessed, 0);
    assert.equal(second.newlyProcessed, 0);
    assert.equal(second.alreadyProcessed, 1);
    assert.equal(repository.count(), 1);
  } finally {
    console.log = originalLog;
    database.close();
  }
});
