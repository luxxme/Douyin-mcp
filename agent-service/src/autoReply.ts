import { createAutoReplyGraph } from "./agent/graph.js";
import { loadConfig } from "./config/env.js";
import { OpenAIReplyGenerator } from "./llm/replyGenerator.js";
import { DouyinClient } from "./mcp/douyinClient.js";
import { ContactPolicy } from "./policy/contactPolicy.js";
import { MessageDebounceTracker } from "./polling/debounce.js";
import { runAutoReplyLoop } from "./polling/poller.js";
import { ReplyRateLimiter } from "./safety/rateLimiter.js";
import { ProcessedMessageRepository } from "./store/processedMessageRepository.js";
import { openAgentDatabase } from "./store/sqlite.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openAgentDatabase(config.sqlitePath);
  const repository = new ProcessedMessageRepository(database);
  const client = new DouyinClient(config.mcpUrl);
  const policy = new ContactPolicy(
    config.allowlist,
    config.blocklist,
    config.allowAll,
  );
  const generator = new OpenAIReplyGenerator({
    apiKey: config.openAIApiKey,
    model: config.openAIModel,
    timeoutMs: config.llmTimeoutMs,
    ...(config.openAIBaseUrl ? { baseUrl: config.openAIBaseUrl } : {}),
  });
  const rateLimiter = new ReplyRateLimiter(
    repository,
    config.maxRepliesPerMinute,
    config.maxRepliesPerContactPerHour,
  );
  const graph = createAutoReplyGraph({
    client,
    repository,
    generator,
    rateLimiter,
    messageLimit: config.phase5MessageLimit,
    sendEnabled: config.autoReplyEnabled,
  });
  const graphRunner = {
    invoke: async (input: Parameters<typeof graph.invoke>[0]) => graph.invoke(input),
  };
  const debounce = new MessageDebounceTracker(config.messageDebounceMs);
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log("Douyin Auto Reply Agent started");
  console.log("Phase: 6 (LangGraph polling)");
  console.log(`Mode: ${config.autoReplyEnabled ? "LIVE SEND" : "DRY RUN"}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Message debounce: ${config.messageDebounceMs}ms`);
  console.log(
    `Allow list: ${config.allowlist.length ? config.allowlist.join(", ") : "(empty)"}`,
  );
  console.log(`Allow all: ${config.allowAll}`);
  console.log("Waiting for messages...");

  try {
    await client.connect();
    console.log("MCP connected");
    await runAutoReplyLoop({
      client,
      repository,
      policy,
      graph: graphRunner,
      debounce,
      messageLimit: config.phase5MessageLimit,
      pollIntervalMs: config.pollIntervalMs,
      signal: abortController.signal,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await client.close().catch(() => undefined);
    database.close();
    console.log("Douyin Auto Reply Agent stopped");
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Auto reply service failed: ${detail}`);
  process.exitCode = 1;
});
