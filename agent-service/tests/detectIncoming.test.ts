import assert from "node:assert/strict";
import test from "node:test";

import {
  findLatestIncomingMessage,
  findTrailingIncomingMessages,
} from "../src/processing/detectIncoming.js";
import type { DouyinMessage } from "../src/types/douyin.js";

function message(
  id: string,
  sender: DouyinMessage["sender"],
  content: string,
): DouyinMessage {
  return {
    id,
    sender,
    sender_name: null,
    content,
    timestamp: null,
    type: "text",
  };
}

test("returns the latest friend message when it is awaiting a reply", () => {
  const messages = [
    message("1", "me", "你好"),
    message("2", "friend", "在吗"),
    message("3", "system", "系统提示"),
  ];

  assert.equal(findLatestIncomingMessage(messages)?.id, "2");
});

test("does not return an older friend message after I already replied", () => {
  const messages = [
    message("1", "friend", "在吗"),
    message("2", "me", "在"),
  ];

  assert.equal(findLatestIncomingMessage(messages), undefined);
});

test("collects consecutive friend messages as one incoming batch", () => {
  const messages = [
    message("1", "friend", "旧消息"),
    message("2", "me", "旧回复"),
    message("3", "friend", "在吗"),
    message("4", "friend", "晚上有空吗"),
    message("5", "friend", "一起吃饭？"),
  ];

  assert.deepEqual(
    findTrailingIncomingMessages(messages).map((item) => item.id),
    ["3", "4", "5"],
  );
});
