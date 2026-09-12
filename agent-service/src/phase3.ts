import { loadConfig } from "./config/env.js";
import { DouyinClient } from "./mcp/douyinClient.js";
import { runPhase3Scan } from "./polling/phase3.js";
import { ProcessedMessageRepository } from "./store/processedMessageRepository.js";
import { openAgentDatabase } from "./store/sqlite.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openAgentDatabase(config.sqlitePath);
  const repository = new ProcessedMessageRepository(database);
  const client = new DouyinClient(config.mcpUrl);

  console.log("Douyin Phase 3 idempotency scanner");
  console.log(`SQLite: ${config.sqlitePath}`);
  console.log(`Message limit: ${config.phase3MessageLimit}`);
  console.log("Mode: OBSERVE ONLY (no LLM, no send_message)\n");

  try {
    await client.connect();
    console.log("MCP connected");
    const summary = await runPhase3Scan(
      client,
      repository,
      config.phase3MessageLimit,
    );
    console.log("\nPhase 3 summary:", summary);
    console.log(`Processed message rows: ${repository.count()}`);
  } finally {
    await client.close().catch(() => undefined);
    database.close();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Phase 3 scan failed: ${detail}`);
  process.exitCode = 1;
});
