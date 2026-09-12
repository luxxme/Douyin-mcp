import assert from "node:assert/strict";
import test from "node:test";

import { createMessageKey } from "../src/utils/messageKey.js";

const message = {
  sender: "friend" as const,
  content: "在吗",
  timestamp: "12:30",
  type: "text" as const,
};

test("uses a real message id before fingerprinting", () => {
  assert.equal(
    createMessageKey("conversation-1", { ...message, id: "message-1" }),
    "message-1",
  );
});

test("creates a stable conversation-scoped fallback fingerprint", () => {
  const first = createMessageKey("conversation-1", message);
  const repeated = createMessageKey("conversation-1", message);
  const otherConversation = createMessageKey("conversation-2", message);

  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, otherConversation);
});
