import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  DOUYIN_MCP_URL: z.url().default("http://127.0.0.1:6789/mcp"),
  PHASE2_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
});

export type AppConfig = {
  mcpUrl: URL;
  messageLimit: number;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    mcpUrl: new URL(parsed.DOUYIN_MCP_URL),
    messageLimit: parsed.PHASE2_MESSAGE_LIMIT,
  };
}
