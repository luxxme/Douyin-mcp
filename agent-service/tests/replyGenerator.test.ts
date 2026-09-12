import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTextContent,
  formatConversationContext,
} from "../src/llm/replyGenerator.js";

test("formats context with sender roles and excludes system messages", () => {
  const context = formatConversationContext([
    {
      id: "system-1",
      sender: "system",
      sender_name: null,
      content: "系统通知",
      timestamp: null,
      type: "other",
    },
    {
      id: "friend-1",
      sender: "friend",
      sender_name: "好友",
      content: " 在吗 ",
      timestamp: "12:00",
      type: "text",
    },
    {
      id: "me-1",
      sender: "me",
      sender_name: null,
      content: "在",
      timestamp: "12:01",
      type: "text",
    },
  ]);

  assert.equal(context, "friend: 在吗\nme: 在");
});

test("extracts text from string and structured model content", () => {
  assert.equal(extractTextContent(" 你好 "), "你好");
  assert.equal(
    extractTextContent([{ type: "text", text: "你" }, { type: "text", text: "好" }]),
    "你好",
  );
});
