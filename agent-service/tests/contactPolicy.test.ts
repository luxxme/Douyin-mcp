import assert from "node:assert/strict";
import test from "node:test";

import { ContactPolicy } from "../src/policy/contactPolicy.js";

test("contact policy fails closed when allowlist is empty", () => {
  const policy = new ContactPolicy([], [], false);
  assert.deepEqual(policy.decide("好友"), {
    allowed: false,
    reason: "not_allowed",
  });
});

test("blocklist overrides allowlist and allow_all", () => {
  const policy = new ContactPolicy(["好友"], ["好友"], true);
  assert.deepEqual(policy.decide("好友"), {
    allowed: false,
    reason: "blocked",
  });
});

test("allowlist overrides a disabled allow_all", () => {
  const policy = new ContactPolicy(["好友"], [], false);
  assert.equal(policy.decide("好友").allowed, true);
  assert.equal(policy.decide("其他人").allowed, false);
});
