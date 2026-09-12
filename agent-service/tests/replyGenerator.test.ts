import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReplyUserContent,
  collectTrailingIncomingImageUrls,
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

test("builds Qwen-compatible multimodal content for trailing friend images", () => {
  const imageUrl = "https://p3.douyinpic.com/sticker.webp";
  const messages = [
    {
      id: "me-1",
      sender: "me" as const,
      sender_name: null,
      content: "看看",
      timestamp: null,
      type: "text" as const,
    },
    {
      id: "image-1",
      sender: "friend" as const,
      sender_name: "好友",
      content: "[图片或表情包]",
      timestamp: null,
      type: "image" as const,
      media_url: imageUrl,
    },
  ];

  assert.deepEqual(collectTrailingIncomingImageUrls(messages), [imageUrl]);
  assert.deepEqual(buildReplyUserContent(messages), [
    {
      type: "image_url",
      image_url: { url: imageUrl },
    },
    {
      type: "text",
      text:
        "最近聊天上下文：\nme: 看看\nfriend: [图片或表情包]\n" +
        "请结合好友刚刚发送的图片或表情包生成回复。",
    },
  ]);
});

test("rejects blob and unrelated historical image URLs", () => {
  const messages = [
    {
      id: "old-image",
      sender: "friend" as const,
      sender_name: "好友",
      content: "[图片或表情包]",
      timestamp: null,
      type: "image" as const,
      media_url: "https://example.com/old.png",
    },
    {
      id: "me-1",
      sender: "me" as const,
      sender_name: null,
      content: "收到",
      timestamp: null,
      type: "text" as const,
    },
    {
      id: "blob-image",
      sender: "friend" as const,
      sender_name: "好友",
      content: "[图片或表情包]",
      timestamp: null,
      type: "image" as const,
      media_url: "blob:https://www.douyin.com/temporary",
    },
  ];

  assert.deepEqual(collectTrailingIncomingImageUrls(messages), []);
});
