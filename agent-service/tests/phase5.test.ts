import assert from "node:assert/strict";
import test from "node:test";

import type { ReplyGenerator } from "../src/llm/replyGenerator.js";
import { ContactPolicy } from "../src/policy/contactPolicy.js";
import {
  runPhase5Scan,
  type Phase5DouyinClient,
} from "../src/polling/phase5.js";
import { ReplyRateLimiter } from "../src/safety/rateLimiter.js";
import { ProcessedMessageRepository } from "../src/store/processedMessageRepository.js";
import { openAgentDatabase } from "../src/store/sqlite.js";

function createClient(
  messageId: string,
  onSend: () => Promise<{ ok: boolean; recipient: string; status: "sent" | "drafted" | "failed"; detail: string }>,
): Phase5DouyinClient {
  return {
    async listConversations() {
      return [
        {
          conversation_id: "conversation-1",
          user_id: "user-1",
          nickname: "好友",
          last_message: "在吗",
          unread: true,
          unread_count: 1,
          timestamp: "12:30",
        },
      ];
    },
    async readMessages(contact) {
      return {
        conversation_id: "conversation-1",
        user_id: "user-1",
        nickname: contact,
        messages: [
          {
            id: messageId,
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
    async sendMessage() {
      return onSend();
    },
  };
}

const generator: ReplyGenerator = {
  async generate() {
    return { shouldReply: true, replyText: "在呀，怎么啦？", reason: "generated" };
  },
};

async function withMutedLogs(run: () => Promise<void>): Promise<void> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

test("Phase 5 Dry Run never calls send_message", async () => {
  const database = openAgentDatabase(":memory:");
  let sendCalls = 0;
  try {
    await withMutedLogs(async () => {
      const repository = new ProcessedMessageRepository(database);
      const summary = await runPhase5Scan(
        createClient("dry-message", async () => {
          sendCalls += 1;
          return { ok: true, recipient: "好友", status: "sent", detail: "sent" };
        }),
        repository,
        new ContactPolicy(["好友"], [], false),
        generator,
        new ReplyRateLimiter(repository, 5, 10),
        { messageLimit: 20, sendEnabled: false },
      );

      assert.equal(summary.dryRuns, 1);
      assert.equal(summary.sent, 0);
      assert.equal(sendCalls, 0);
      assert.equal(repository.listRecent(1)[0]?.disposition, "phase5_dry_run");
    });
  } finally {
    database.close();
  }
});

test("enabled Phase 5 sends once and records success", async () => {
  const database = openAgentDatabase(":memory:");
  let sendCalls = 0;
  try {
    await withMutedLogs(async () => {
      const repository = new ProcessedMessageRepository(database);
      const client = createClient("sent-message", async () => {
        sendCalls += 1;
        return { ok: true, recipient: "好友", status: "sent", detail: "sent" };
      });
      const limiter = new ReplyRateLimiter(repository, 5, 10);
      const options = { messageLimit: 20, sendEnabled: true };
      const policy = new ContactPolicy(["好友"], [], false);

      const first = await runPhase5Scan(
        client,
        repository,
        policy,
        generator,
        limiter,
        options,
      );
      const second = await runPhase5Scan(
        client,
        repository,
        policy,
        generator,
        limiter,
        options,
      );

      assert.equal(first.sent, 1);
      assert.equal(second.alreadyProcessed, 1);
      assert.equal(sendCalls, 1);
      assert.equal(repository.listRecent(1)[0]?.disposition, "phase5_sent");
    });
  } finally {
    database.close();
  }
});

test("definite send failure releases the reservation for retry", async () => {
  const database = openAgentDatabase(":memory:");
  try {
    await withMutedLogs(async () => {
      const repository = new ProcessedMessageRepository(database);
      const summary = await runPhase5Scan(
        createClient("failed-message", async () => ({
          ok: false,
          recipient: "好友",
          status: "failed",
          detail: "input unavailable",
        })),
        repository,
        new ContactPolicy(["好友"], [], false),
        generator,
        new ReplyRateLimiter(repository, 5, 10),
        { messageLimit: 20, sendEnabled: true },
      );

      assert.equal(summary.failed, 1);
      assert.equal(repository.count(), 0);
    });
  } finally {
    database.close();
  }
});

test("ambiguous drafted result is not retried automatically", async () => {
  const database = openAgentDatabase(":memory:");
  let sendCalls = 0;
  try {
    await withMutedLogs(async () => {
      const repository = new ProcessedMessageRepository(database);
      const client = createClient("uncertain-message", async () => {
        sendCalls += 1;
        return {
          ok: false,
          recipient: "好友",
          status: "drafted",
          detail: "typed but click result unknown",
        };
      });
      const policy = new ContactPolicy(["好友"], [], false);
      const limiter = new ReplyRateLimiter(repository, 5, 10);
      const options = { messageLimit: 20, sendEnabled: true };

      const first = await runPhase5Scan(
        client,
        repository,
        policy,
        generator,
        limiter,
        options,
      );
      const second = await runPhase5Scan(
        client,
        repository,
        policy,
        generator,
        limiter,
        options,
      );

      assert.equal(first.sendUncertain, 1);
      assert.equal(second.alreadyProcessed, 1);
      assert.equal(sendCalls, 1);
      assert.equal(
        repository.listRecent(1)[0]?.disposition,
        "phase5_send_uncertain",
      );
    });
  } finally {
    database.close();
  }
});

test("rate limit blocks send_message and records the skip", async () => {
  const database = openAgentDatabase(":memory:");
  let sendCalls = 0;
  try {
    await withMutedLogs(async () => {
      const repository = new ProcessedMessageRepository(database);
      repository.markProcessed({
        conversationId: "another-conversation",
        messageKey: "previous-send",
        message: {
          id: "previous-send",
          sender: "friend",
          sender_name: "其他好友",
          content: "hello",
          timestamp: null,
          type: "text",
        },
        disposition: "phase5_sent",
      });

      const summary = await runPhase5Scan(
        createClient("rate-limited-message", async () => {
          sendCalls += 1;
          return { ok: true, recipient: "好友", status: "sent", detail: "sent" };
        }),
        repository,
        new ContactPolicy(["好友"], [], false),
        generator,
        new ReplyRateLimiter(repository, 1, 10),
        { messageLimit: 20, sendEnabled: true },
      );

      assert.equal(summary.rateLimited, 1);
      assert.equal(sendCalls, 0);
      assert.equal(
        repository.listRecent(1)[0]?.disposition,
        "phase5_skipped_rate_limit",
      );
    });
  } finally {
    database.close();
  }
});
