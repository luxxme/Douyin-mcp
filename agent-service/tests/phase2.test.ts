import assert from "node:assert/strict";
import test from "node:test";

import {
  runPhase2Scan,
  type Phase2DouyinClient,
} from "../src/polling/phase2.js";

test("reads only unread conversations and prints recent messages", async () => {
  const reads: string[] = [];
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));

  const client: Phase2DouyinClient = {
    async listConversations() {
      return [
        {
          conversation_id: "unread-1",
          user_id: "user-1",
          nickname: "未读好友",
          last_message: "在吗",
          unread: true,
          unread_count: 1,
          timestamp: "12:31",
        },
        {
          conversation_id: "read-1",
          user_id: "user-2",
          nickname: "已读好友",
          last_message: "你好",
          unread: false,
          unread_count: 0,
          timestamp: "12:30",
        },
      ];
    },
    async readMessages(contact, _limit) {
      reads.push(contact);
      return {
        conversation_id: "unread-1",
        user_id: "user-1",
        nickname: contact,
        messages: [
          {
            id: "message-1",
            sender: "friend",
            sender_name: contact,
            content: "在吗",
            timestamp: "12:31",
            type: "text",
          },
        ],
        count: 1,
      };
    },
  };

  try {
    await runPhase2Scan(client, 20);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(reads, ["未读好友"]);
  assert.ok(lines.some((line) => line.includes("friend: 在吗")));
});
