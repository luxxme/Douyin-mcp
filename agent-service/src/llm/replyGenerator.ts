import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import { AUTO_REPLY_SYSTEM_PROMPT } from "../prompts/autoReplyPrompt.js";
import type { DouyinMessage } from "../types/douyin.js";

export type ReplyGeneration =
  | { shouldReply: true; replyText: string; reason: "generated" }
  | { shouldReply: false; reason: "model_declined" | "empty_response" };

export interface ReplyGenerator {
  generate(messages: readonly DouyinMessage[]): Promise<ReplyGeneration>;
}

export type OpenAIReplyGeneratorOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
};

export function formatConversationContext(
  messages: readonly DouyinMessage[],
): string {
  return messages
    .filter((message) => message.sender !== "system" && message.content.trim())
    .map((message) => `${message.sender}: ${message.content.trim()}`)
    .join("\n");
}

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (
        item &&
        typeof item === "object" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        return item.text;
      }
      return "";
    })
    .join("")
    .trim();
}

export class OpenAIReplyGenerator implements ReplyGenerator {
  private model?: ChatOpenAI;

  constructor(private readonly options: OpenAIReplyGeneratorOptions) {}

  async generate(messages: readonly DouyinMessage[]): Promise<ReplyGeneration> {
    const context = formatConversationContext(messages);
    if (!context) return { shouldReply: false, reason: "empty_response" };

    const response = await this.getModel().invoke([
      new SystemMessage(AUTO_REPLY_SYSTEM_PROMPT),
      new HumanMessage(`最近聊天上下文：\n${context}`),
    ]);
    const replyText = extractTextContent(response.content);

    if (!replyText) return { shouldReply: false, reason: "empty_response" };
    if (replyText.trim().toUpperCase() === "NO_REPLY") {
      return { shouldReply: false, reason: "model_declined" };
    }
    return { shouldReply: true, replyText, reason: "generated" };
  }

  private getModel(): ChatOpenAI {
    if (!this.options.apiKey) {
      throw new Error("OPENAI_API_KEY is required for an eligible conversation");
    }
    if (!this.options.model) {
      throw new Error("OPENAI_MODEL is required for an eligible conversation");
    }
    this.model ??= new ChatOpenAI({
      apiKey: this.options.apiKey,
      model: this.options.model,
      temperature: 0.7,
      timeout: this.options.timeoutMs,
      maxRetries: 2,
      ...(this.options.baseUrl
        ? { configuration: { baseURL: this.options.baseUrl } }
        : {}),
    });
    return this.model;
  }
}
