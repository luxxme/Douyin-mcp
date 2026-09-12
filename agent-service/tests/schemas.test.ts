import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversationListResultSchema,
  ReadMessagesResultSchema,
} from "../src/types/douyin.js";

test("parses structured conversation output", () => {
  const parsed = ConversationListResultSchema.parse({
    conversations: [
      {
        conversation_id: "conversation-1",
        user_id: "sec-user-1",
        nickname: "好友",
        last_message: "在吗",
        unread: true,
        unread_count: 1,
        timestamp: "12:30",
      },
    ],
    count: 1,
  });

  assert.equal(parsed.conversations[0]?.unread, true);
});

test("parses normalized message directions", () => {
  const parsed = ReadMessagesResultSchema.parse({
    conversation_id: "conversation-1",
    user_id: "sec-user-1",
    nickname: "好友",
    messages: [
      {
        id: "message-1",
        sender: "friend",
        sender_name: "好友",
        content: "在吗",
        timestamp: "12:31",
        type: "text",
      },
    ],
    count: 1,
  });

  assert.equal(parsed.messages[0]?.sender, "friend");
});
