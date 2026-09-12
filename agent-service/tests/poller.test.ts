import assert from "node:assert/strict";
import test from "node:test";

import type { AutoReplyGraphRunner } from "../src/polling/poller.js";
import { ConversationActivityTracker } from "../src/polling/conversationActivity.js";
import { MessageDebounceTracker } from "../src/polling/debounce.js";
import { runPollCycle, sleepWithSignal } from "../src/polling/poller.js";
import { ContactPolicy } from "../src/policy/contactPolicy.js";
import { ProcessedMessageRepository } from "../src/store/processedMessageRepository.js";
import { openAgentDatabase } from "../src/store/sqlite.js";
import type { Conversation } from "../src/types/douyin.js";

const conversation: Conversation = {
  conversation_id: "conversation-1",
  user_id: "user-1",
  nickname: "好友",
  last_message: "在吗",
  unread: true,
  unread_count: 1,
  timestamp: "12:30",
};

function muteLogs(): () => void {
  const originalLog = console.log;
  console.log = () => undefined;
  return () => {
    console.log = originalLog;
  };
}

test("poll cycle waits for debounce before invoking the graph", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let graphCalls = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const client = {
      async listConversations() {
        return [conversation];
      },
      async readMessages() {
        return {
          conversation_id: conversation.conversation_id,
          user_id: conversation.user_id,
          nickname: conversation.nickname,
          messages: [
            {
              id: "message-1",
              sender: "friend" as const,
              sender_name: conversation.nickname,
              content: "在吗",
              timestamp: null,
              type: "text" as const,
            },
          ],
          count: 1,
        };
      },
    };
    const graph: AutoReplyGraphRunner = {
      async invoke(input) {
        graphCalls += 1;
        return {
          conversation: input.conversation,
          expectedMessageKey: input.expectedMessageKey,
          messages: [],
          incomingBatch: [],
          messageChangedDuringDebounce: false,
          alreadyProcessed: false,
          shouldReply: true,
          outcome: "dry_run",
        };
      },
    };
    const debounce = new MessageDebounceTracker(5_000);
    const policy = new ContactPolicy(["好友"], [], false);

    const first = await runPollCycle(
      client,
      repository,
      policy,
      graph,
      debounce,
      20,
      0,
    );
    const second = await runPollCycle(
      client,
      repository,
      policy,
      graph,
      debounce,
      20,
      5_000,
    );

    assert.equal(first.debounceWaiting, 1);
    assert.equal(second.processed, 1);
    assert.equal(graphCalls, 1);
    assert.equal(debounce.size, 0);
  } finally {
    restoreLogs();
    database.close();
  }
});

test("poll cycle resets debounce when a newer incoming message appears", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let currentMessageId = "message-1";
  let graphCalls = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const client = {
      async listConversations() {
        return [conversation];
      },
      async readMessages() {
        return {
          conversation_id: conversation.conversation_id,
          user_id: conversation.user_id,
          nickname: conversation.nickname,
          messages: [
            {
              id: currentMessageId,
              sender: "friend" as const,
              sender_name: conversation.nickname,
              content: "补充消息",
              timestamp: null,
              type: "text" as const,
            },
          ],
          count: 1,
        };
      },
    };
    const graph: AutoReplyGraphRunner = {
      async invoke(input) {
        graphCalls += 1;
        return {
          conversation: input.conversation,
          expectedMessageKey: input.expectedMessageKey,
          messages: [],
          incomingBatch: [],
          messageChangedDuringDebounce: false,
          alreadyProcessed: false,
          shouldReply: true,
          outcome: "dry_run",
        };
      },
    };
    const debounce = new MessageDebounceTracker(5_000);
    const policy = new ContactPolicy(["好友"], [], false);

    await runPollCycle(client, repository, policy, graph, debounce, 20, 0);
    currentMessageId = "message-2";
    const reset = await runPollCycle(
      client,
      repository,
      policy,
      graph,
      debounce,
      20,
      5_000,
    );
    const ready = await runPollCycle(
      client,
      repository,
      policy,
      graph,
      debounce,
      20,
      10_000,
    );

    assert.equal(reset.debounceWaiting, 1);
    assert.equal(ready.processed, 1);
    assert.equal(graphCalls, 1);
  } finally {
    restoreLogs();
    database.close();
  }
});

test("abort signal ends polling sleep immediately", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const sleeping = sleepWithSignal(60_000, controller.signal);
  controller.abort();
  await sleeping;
  assert.ok(Date.now() - startedAt < 1_000);
});

test("polling skips unchanged inactive allowlisted conversations", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  const conversations = [
    { ...conversation, unread: false, unread_count: 0 },
    {
      ...conversation,
      conversation_id: "conversation-2",
      user_id: "user-2",
      nickname: "好友二",
      unread: false,
      unread_count: 0,
    },
    {
      ...conversation,
      conversation_id: "conversation-3",
      user_id: "user-3",
      nickname: "好友三",
      unread: false,
      unread_count: 0,
    },
  ];
  let reads = 0;

  try {
    const repository = new ProcessedMessageRepository(database);
    const client = {
      async listConversations() {
        return conversations;
      },
      async readMessages(contact: string) {
        reads += 1;
        const current = conversations.find((item) => item.nickname === contact)!;
        return {
          conversation_id: current.conversation_id,
          user_id: current.user_id,
          nickname: current.nickname,
          messages: [],
          count: 0,
        };
      },
    };
    const graph: AutoReplyGraphRunner = {
      async invoke() {
        throw new Error("graph should not run without incoming messages");
      },
    };
    const debounce = new MessageDebounceTracker(5_000);
    const policy = new ContactPolicy(
      conversations.map((item) => item.nickname),
      [],
      false,
    );
    const activity = new ConversationActivityTracker();

    const baseline = await runPollCycle(
      client,
      repository,
      policy,
      graph,
      debounce,
      20,
      0,
      activity,
    );
    const unchanged = await runPollCycle(
      client,
      repository,
      policy,
      graph,
      debounce,
      20,
      10_000,
      activity,
    );

    assert.equal(baseline.noIncoming, 3);
    assert.equal(unchanged.activitySkipped, 2);
    assert.equal(unchanged.noIncoming, 1);
    assert.equal(reads, 4);
  } finally {
    restoreLogs();
    database.close();
  }
});
