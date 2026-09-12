import assert from "node:assert/strict";
import test from "node:test";

import { ConversationActivityTracker } from "../src/polling/conversationActivity.js";
import type { Conversation } from "../src/types/douyin.js";

const baseConversation: Conversation = {
  conversation_id: "conversation-1",
  user_id: "user-1",
  nickname: "好友",
  last_message: "你好",
  unread: false,
  unread_count: 0,
  timestamp: "12:30",
};

test("activity tracker inspects a baseline once and skips unchanged inactive rows", () => {
  const tracker = new ConversationActivityTracker();

  assert.equal(tracker.shouldInspect(baseConversation), true);
  assert.equal(tracker.shouldInspect(baseConversation), false);
});

test("activity tracker keeps the last opened conversation hot", () => {
  const tracker = new ConversationActivityTracker();
  tracker.shouldInspect(baseConversation);
  tracker.markOpened(baseConversation.conversation_id);

  assert.equal(tracker.shouldInspect(baseConversation), true);
});

test("activity tracker reacts to unread, summary changes, and debounce", () => {
  const tracker = new ConversationActivityTracker();
  tracker.shouldInspect(baseConversation);

  assert.equal(
    tracker.shouldInspect({ ...baseConversation, unread: true, unread_count: 1 }),
    true,
  );
  assert.equal(
    tracker.shouldInspect({ ...baseConversation, last_message: "新消息" }),
    true,
  );
  assert.equal(tracker.shouldInspect(baseConversation, true), true);
});
