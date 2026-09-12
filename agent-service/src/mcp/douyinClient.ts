import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { z } from "zod";

import {
  ConversationListResultSchema,
  ReadMessagesResultSchema,
  type Conversation,
  type ReadMessagesResult,
} from "../types/douyin.js";

export class DouyinClient {
  private readonly client = new Client({
    name: "douyin-auto-reply-agent",
    version: "0.1.0",
  });

  private readonly transport: StreamableHTTPClientTransport;

  constructor(mcpUrl: URL) {
    this.transport = new StreamableHTTPClientTransport(mcpUrl);
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.transport.terminateSession();
    await this.client.close();
  }

  async listConversations(): Promise<Conversation[]> {
    const result = await this.callStructured(
      "list_conversations",
      {},
      ConversationListResultSchema,
    );
    return result.conversations;
  }

  async readMessages(
    contact: string,
    limit: number,
  ): Promise<ReadMessagesResult> {
    return this.callStructured(
      "read_messages",
      { contact, limit },
      ReadMessagesResultSchema,
    );
  }

  private async callStructured<TSchema extends z.ZodType>(
    name: string,
    args: Record<string, unknown>,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      const detail = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      throw new Error(`${name} failed${detail ? `: ${detail}` : ""}`);
    }
    if (!result.structuredContent) {
      throw new Error(`${name} returned no structuredContent`);
    }
    return schema.parse(result.structuredContent);
  }
}
