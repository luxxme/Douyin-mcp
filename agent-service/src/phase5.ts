import { loadConfig } from "./config/env.js";
import { OpenAIReplyGenerator } from "./llm/replyGenerator.js";
import { DouyinClient } from "./mcp/douyinClient.js";
import { ContactPolicy } from "./policy/contactPolicy.js";
import { runPhase5Scan } from "./polling/phase5.js";
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

  console.log("Douyin Auto Reply Agent started");
  console.log("Phase: 5 (controlled send)");
  console.log(`Mode: ${config.autoReplyEnabled ? "LIVE SEND" : "DRY RUN"}`);
  console.log(
    `Allow list: ${config.allowlist.length ? config.allowlist.join(", ") : "(empty)"}`,
  );
  console.log(`Allow all: ${config.allowAll}`);
  console.log(`Block list entries: ${config.blocklist.length}`);
  console.log(
    `Rate limits: ${config.maxRepliesPerMinute}/minute, ${config.maxRepliesPerContactPerHour}/contact/hour`,
  );

  try {
    await client.connect();
    console.log("MCP connected");
    const summary = await runPhase5Scan(
      client,
      repository,
      policy,
      generator,
      rateLimiter,
      {
        messageLimit: config.phase5MessageLimit,
        sendEnabled: config.autoReplyEnabled,
      },
    );
    console.log("\nPhase 5 summary:", summary);
    console.log(`Processed message rows: ${repository.count()}`);
  } finally {
    await client.close().catch(() => undefined);
    database.close();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Phase 5 scan failed: ${detail}`);
  process.exitCode = 1;
});
