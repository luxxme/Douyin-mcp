import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  DOUYIN_MCP_URL: z.url().default("http://127.0.0.1:6789/mcp"),
  PHASE2_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  PHASE3_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  PHASE4_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  SQLITE_PATH: z.string().min(1).default("./data/douyin-agent.db"),
  AUTO_REPLY_ENABLED: z.string().default("false"),
  AUTO_REPLY_ALLOWLIST: z.string().default(""),
  AUTO_REPLY_BLOCKLIST: z.string().default(""),
  AUTO_REPLY_ALLOW_ALL: z.string().default("false"),
  OPENAI_BASE_URL: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default(""),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseNameList(value: string): string[] {
  return [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
}

export type AppConfig = {
  mcpUrl: URL;
  messageLimit: number;
  phase3MessageLimit: number;
  phase4MessageLimit: number;
  sqlitePath: string;
  autoReplyEnabled: boolean;
  allowlist: string[];
  blocklist: string[];
  allowAll: boolean;
  openAIBaseUrl?: string;
  openAIApiKey: string;
  openAIModel: string;
  llmTimeoutMs: number;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    mcpUrl: new URL(parsed.DOUYIN_MCP_URL),
    messageLimit: parsed.PHASE2_MESSAGE_LIMIT,
    phase3MessageLimit: parsed.PHASE3_MESSAGE_LIMIT,
    phase4MessageLimit: parsed.PHASE4_MESSAGE_LIMIT,
    sqlitePath: parsed.SQLITE_PATH,
    autoReplyEnabled: parseBoolean(parsed.AUTO_REPLY_ENABLED, "AUTO_REPLY_ENABLED"),
    allowlist: parseNameList(parsed.AUTO_REPLY_ALLOWLIST),
    blocklist: parseNameList(parsed.AUTO_REPLY_BLOCKLIST),
    allowAll: parseBoolean(parsed.AUTO_REPLY_ALLOW_ALL, "AUTO_REPLY_ALLOW_ALL"),
    ...(parsed.OPENAI_BASE_URL.trim()
      ? { openAIBaseUrl: parsed.OPENAI_BASE_URL.trim() }
      : {}),
    openAIApiKey: parsed.OPENAI_API_KEY.trim(),
    openAIModel: parsed.OPENAI_MODEL.trim(),
    llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
  };
}
