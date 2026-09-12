import assert from "node:assert/strict";
import test from "node:test";

import type { ReplyGenerator } from "../src/llm/replyGenerator.js";
import { ContactPolicy } from "../src/policy/contactPolicy.js";
import {
  runPhase4Scan,
  type Phase4DouyinClient,
} from "../src/polling/phase4.js";
import { ProcessedMessageRepository } from "../src/store/processedMessageRepository.js";
import { openAgentDatabase } from "../src/store/sqlite.js";

test("dry run generates and records a reply exactly once", async () => {
  const database = openAgentDatabase(":memory:");
  const originalLog = console.log;
  console.log = () => undefined;
  let reads = 0;
  let generations = 0;
  const client: Phase4DouyinClient = {
    async listConversations() {
      return [
        {
          conversation_id: "conversation-1",
          user_id: "user-1",
          nickname: "好友",
          last_message: "在吗",
          unread: false,
          unread_count: 0,
          timestamp: "12:30",
        },
      ];
    },
    async readMessages(contact) {
      reads += 1;
      return {
        conversation_id: "conversation-1",
        user_id: "user-1",
        nickname: contact,
        messages: [
          {
            id: "message-1",
            sender: "friend",
            sender_name: contact,
            content: "在吗",
            timestamp: "12:30",
            type: "text",
          },
        ],
        count: 1,
      };
    },
  };
  const generator: ReplyGenerator = {
    async generate() {
      generations += 1;
      return { shouldReply: true, replyText: "在呀，怎么啦？", reason: "generated" };
    },
  };

  try {
    const repository = new ProcessedMessageRepository(database);
    const policy = new ContactPolicy(["好友"], [], false);
    const first = await runPhase4Scan(client, repository, policy, generator, 20);
    const second = await runPhase4Scan(client, repository, policy, generator, 20);

    assert.equal(first.repliesGenerated, 1);
    assert.equal(second.alreadyProcessed, 1);
    assert.equal(generations, 1);
    assert.equal(reads, 2);
    assert.equal(repository.listRecent(1)[0]?.reply_content, "在呀，怎么啦？");
    assert.equal(repository.listRecent(1)[0]?.disposition, "phase4_dry_run");
  } finally {
    console.log = originalLog;
    database.close();
  }
});

test("denied contacts are not read and do not call the LLM", async () => {
  const database = openAgentDatabase(":memory:");
  const originalLog = console.log;
  console.log = () => undefined;
  let reads = 0;
  let generations = 0;
  const client: Phase4DouyinClient = {
    async listConversations() {
      return [
        {
          conversation_id: "conversation-1",
          user_id: "user-1",
          nickname: "未授权好友",
          last_message: "在吗",
          unread: true,
          unread_count: 1,
          timestamp: "12:30",
        },
      ];
    },
    async readMessages() {
      reads += 1;
      throw new Error("must not read");
    },
  };
  const generator: ReplyGenerator = {
    async generate() {
      generations += 1;
      return { shouldReply: false, reason: "model_declined" };
    },
  };

  try {
    const repository = new ProcessedMessageRepository(database);
    const summary = await runPhase4Scan(
      client,
      repository,
      new ContactPolicy([], [], false),
      generator,
      20,
    );
    assert.equal(summary.policySkipped, 1);
    assert.equal(reads, 0);
    assert.equal(generations, 0);
    assert.equal(repository.count(), 0);
  } finally {
    console.log = originalLog;
    database.close();
  }
});
