import { loadConfig } from "./config/env.js";
import { DouyinClient } from "./mcp/douyinClient.js";
import { runPhase2Scan } from "./polling/phase2.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new DouyinClient(config.mcpUrl);

  console.log("Douyin Phase 2 MCP reader");
  console.log(`MCP endpoint: ${config.mcpUrl.toString()}`);
  console.log(`Message limit: ${config.messageLimit}`);
  console.log("Mode: READ ONLY (send_message is never called)\n");

  try {
    await client.connect();
    console.log("MCP connected");
    await runPhase2Scan(client, config.messageLimit);
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Phase 2 scan failed: ${detail}`);
  process.exitCode = 1;
});
