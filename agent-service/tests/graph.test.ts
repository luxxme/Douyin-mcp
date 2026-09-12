import assert from "node:assert/strict";
import test from "node:test";

import { createAutoReplyGraph } from "../src/agent/graph.js";
import type { ReplyGenerator } from "../src/llm/replyGenerator.js";
import { ReplyRateLimiter } from "../src/safety/rateLimiter.js";
import { ProcessedMessageRepository } from "../src/store/processedMessageRepository.js";
import { openAgentDatabase } from "../src/store/sqlite.js";
import type { Conversation, DouyinMessage } from "../src/types/douyin.js";

const conversation: Conversation = {
  conversation_id: "conversation-1",
  user_id: "user-1",
  nickname: "好友",
  last_message: "一起吃饭？",
  unread: true,
  unread_count: 3,
  timestamp: "12:30",
};

function incoming(id: string, content: string, type: DouyinMessage["type"] = "text"): DouyinMessage {
  return {
    id,
    sender: "friend",
    sender_name: "好友",
    content,
    timestamp: null,
    type,
  };
}

function muteLogs(): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };
}

test("LangGraph merges trailing incoming messages and completes Dry Run", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let generatorMessages: readonly DouyinMessage[] = [];
  let sendCalls = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const messages = [
      { ...incoming("old-me", "之前回复"), sender: "me" as const },
      incoming("message-1", "在吗"),
      incoming("message-2", "晚上有空吗"),
      incoming("message-3", "一起吃饭？"),
    ];
    const generator: ReplyGenerator = {
      async generate(receivedMessages) {
        generatorMessages = receivedMessages;
        return { shouldReply: true, replyText: "可以呀，想吃什么？", reason: "generated" };
      },
    };
    const graph = createAutoReplyGraph({
      client: {
        async readMessages() {
          return {
            conversation_id: conversation.conversation_id,
            user_id: conversation.user_id,
            nickname: conversation.nickname,
            messages,
            count: messages.length,
          };
        },
        async sendMessage() {
          sendCalls += 1;
          return { ok: true, recipient: "好友", status: "sent", detail: "sent" };
        },
      },
      repository,
      generator,
      rateLimiter: new ReplyRateLimiter(repository, 5, 10),
      messageLimit: 20,
      sendEnabled: false,
    });

    const result = await graph.invoke({
      conversation,
      expectedMessageKey: "message-3",
    });

    assert.equal(result.outcome, "dry_run");
    assert.deepEqual(result.incomingBatch.map((item) => item.id), [
      "message-1",
      "message-2",
      "message-3",
    ]);
    assert.equal(generatorMessages.length, 4);
    assert.equal(sendCalls, 0);
    assert.equal(repository.listRecent(1)[0]?.disposition, "phase6_dry_run");
  } finally {
    restoreLogs();
    database.close();
  }
});

test("alreadyProcessed conditional edge ends before LLM generation", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let generations = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const message = incoming("processed-message", "在吗");
    repository.markProcessed({
      conversationId: conversation.conversation_id,
      messageKey: message.id,
      message,
      disposition: "phase5_sent",
    });
    const generator: ReplyGenerator = {
      async generate() {
        generations += 1;
        return { shouldReply: true, replyText: "在", reason: "generated" };
      },
    };
    const graph = createAutoReplyGraph({
      client: {
        async readMessages() {
          return {
            conversation_id: conversation.conversation_id,
            user_id: conversation.user_id,
            nickname: conversation.nickname,
            messages: [message],
            count: 1,
          };
        },
        async sendMessage() {
          throw new Error("must not send");
        },
      },
      repository,
      generator,
      rateLimiter: new ReplyRateLimiter(repository, 5, 10),
      messageLimit: 20,
      sendEnabled: false,
    });

    const result = await graph.invoke({
      conversation,
      expectedMessageKey: message.id,
    });
    assert.equal(result.outcome, "already_processed");
    assert.equal(generations, 0);
  } finally {
    restoreLogs();
    database.close();
  }
});

test("shouldReply conditional edge skips unsupported message types", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let generations = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const message = incoming("video-message", "[视频]", "video");
    const graph = createAutoReplyGraph({
      client: {
        async readMessages() {
          return {
            conversation_id: conversation.conversation_id,
            user_id: conversation.user_id,
            nickname: conversation.nickname,
            messages: [message],
            count: 1,
          };
        },
        async sendMessage() {
          throw new Error("must not send");
        },
      },
      repository,
      generator: {
        async generate() {
          generations += 1;
          return { shouldReply: true, replyText: "收到", reason: "generated" };
        },
      },
      rateLimiter: new ReplyRateLimiter(repository, 5, 10),
      messageLimit: 20,
      sendEnabled: false,
    });

    const result = await graph.invoke({
      conversation,
      expectedMessageKey: message.id,
    });
    assert.equal(result.outcome, "skipped");
    assert.equal(generations, 0);
    assert.equal(repository.listRecent(1)[0]?.disposition, "phase6_skipped");
  } finally {
    restoreLogs();
    database.close();
  }
});

test("shouldReply accepts an image with a media URL", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let generations = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const message = {
      ...incoming("image-message", "[图片或表情包]", "image"),
      media_url: "https://p3.douyinpic.com/sticker.webp",
    };
    const graph = createAutoReplyGraph({
      client: {
        async readMessages() {
          return {
            conversation_id: conversation.conversation_id,
            user_id: conversation.user_id,
            nickname: conversation.nickname,
            messages: [message],
            count: 1,
          };
        },
        async sendMessage() {
          throw new Error("Dry Run must not send");
        },
      },
      repository,
      generator: {
        async generate() {
          generations += 1;
          return { shouldReply: true, replyText: "这个表情也太真实了 😂", reason: "generated" };
        },
      },
      rateLimiter: new ReplyRateLimiter(repository, 5, 10),
      messageLimit: 20,
      sendEnabled: false,
    });

    const result = await graph.invoke({
      conversation,
      expectedMessageKey: message.id,
    });
    assert.equal(result.outcome, "dry_run");
    assert.equal(generations, 1);
  } finally {
    restoreLogs();
    database.close();
  }
});

test("graph detects a message arriving during debounce", async () => {
  const database = openAgentDatabase(":memory:");
  try {
    const repository = new ProcessedMessageRepository(database);
    const newest = incoming("newer-message", "又补充一句");
    const graph = createAutoReplyGraph({
      client: {
        async readMessages() {
          return {
            conversation_id: conversation.conversation_id,
            user_id: conversation.user_id,
            nickname: conversation.nickname,
            messages: [newest],
            count: 1,
          };
        },
        async sendMessage() {
          throw new Error("must not send");
        },
      },
      repository,
      generator: {
        async generate() {
          throw new Error("must not generate");
        },
      },
      rateLimiter: new ReplyRateLimiter(repository, 5, 10),
      messageLimit: 20,
      sendEnabled: false,
    });

    const result = await graph.invoke({
      conversation,
      expectedMessageKey: "older-message",
    });
    assert.equal(result.outcome, "debounce_reset");
    assert.equal(result.messageKey, "newer-message");
    assert.equal(repository.count(), 0);
  } finally {
    database.close();
  }
});

test("LangGraph live delivery reserves and records one successful send", async () => {
  const database = openAgentDatabase(":memory:");
  const restoreLogs = muteLogs();
  let sendCalls = 0;
  try {
    const repository = new ProcessedMessageRepository(database);
    const message = incoming("phase6-live-message", "在吗");
    const graph = createAutoReplyGraph({
      client: {
        async readMessages() {
          return {
            conversation_id: conversation.conversation_id,
            user_id: conversation.user_id,
            nickname: conversation.nickname,
            messages: [message],
            count: 1,
          };
        },
        async sendMessage() {
          sendCalls += 1;
          return {
            ok: true,
            recipient: conversation.nickname,
            status: "sent",
            detail: "sent",
          };
        },
      },
      repository,
      generator: {
        async generate() {
          return { shouldReply: true, replyText: "在呀", reason: "generated" };
        },
      },
      rateLimiter: new ReplyRateLimiter(repository, 5, 10),
      messageLimit: 20,
      sendEnabled: true,
    });

    const result = await graph.invoke({
      conversation,
      expectedMessageKey: message.id,
    });
    assert.equal(result.outcome, "sent");
    assert.equal(sendCalls, 1);
    assert.equal(repository.listRecent(1)[0]?.disposition, "phase6_sent");
  } finally {
    restoreLogs();
    database.close();
  }
});
