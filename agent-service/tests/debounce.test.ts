import assert from "node:assert/strict";
import test from "node:test";

import { MessageDebounceTracker } from "../src/polling/debounce.js";

test("debounce waits, resets for a newer message, then becomes ready", () => {
  const tracker = new MessageDebounceTracker(5_000);

  assert.equal(tracker.observe("conversation", "message-1", 0), "waiting");
  assert.equal(tracker.observe("conversation", "message-1", 4_999), "waiting");
  assert.equal(tracker.observe("conversation", "message-2", 5_000), "waiting");
  assert.equal(tracker.observe("conversation", "message-2", 9_999), "waiting");
  assert.equal(tracker.observe("conversation", "message-2", 10_000), "ready");
});

test("debounce can be disabled and exposes the next wake delay", () => {
  const immediate = new MessageDebounceTracker(0);
  assert.equal(immediate.observe("conversation", "message", 100), "ready");

  const tracker = new MessageDebounceTracker(5_000);
  tracker.observe("conversation", "message", 1_000);
  assert.equal(tracker.nextDelay(2_000, 10_000), 4_000);
  tracker.clear("conversation");
  assert.equal(tracker.nextDelay(2_000, 10_000), 10_000);
});
