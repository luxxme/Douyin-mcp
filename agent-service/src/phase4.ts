import { loadConfig } from "./config/env.js";
import { OpenAIReplyGenerator } from "./llm/replyGenerator.js";
import { DouyinClient } from "./mcp/douyinClient.js";
import { ContactPolicy } from "./policy/contactPolicy.js";
import { runPhase4Scan } from "./polling/phase4.js";
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

  console.log("Douyin Auto Reply Agent started");
  console.log("Phase: 4 (LLM generation)");
  console.log("Mode: DRY RUN (send_message is not available in this service)");
  console.log(
    `Allow list: ${config.allowlist.length ? config.allowlist.join(", ") : "(empty)"}`,
  );
  console.log(`Allow all: ${config.allowAll}`);
  console.log(`Block list entries: ${config.blocklist.length}`);
  console.log(`Message limit: ${config.phase4MessageLimit}`);
  if (config.autoReplyEnabled) {
    console.warn(
      "AUTO_REPLY_ENABLED=true is ignored in Phase 4; this command cannot send messages.",
    );
  }

  try {
    await client.connect();
    console.log("MCP connected");
    const summary = await runPhase4Scan(
      client,
      repository,
      policy,
      generator,
      config.phase4MessageLimit,
    );
    console.log("\nPhase 4 summary:", summary);
    console.log(`Processed message rows: ${repository.count()}`);
  } finally {
    await client.close().catch(() => undefined);
    database.close();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Phase 4 scan failed: ${detail}`);
  process.exitCode = 1;
});
