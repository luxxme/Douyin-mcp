import {
  HumanMessage,
  SystemMessage,
  type MessageContent,
  type MessageContentComplex,
} from "@langchain/core/messages";
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

function isSupportedImageUrl(value: string): boolean {
  if (/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function collectTrailingIncomingImageUrls(
  messages: readonly DouyinMessage[],
  limit = 3,
): string[] {
  const urls: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.sender === "system") continue;
    if (message.sender === "me") break;
    const mediaUrl = message.media_url?.trim();
    if (
      message.type === "image" &&
      mediaUrl &&
      isSupportedImageUrl(mediaUrl)
    ) {
      urls.unshift(mediaUrl);
      if (urls.length >= limit) break;
    }
  }
  return urls;
}

export function buildReplyUserContent(
  messages: readonly DouyinMessage[],
): MessageContent {
  const context = formatConversationContext(messages);
  const prompt = `最近聊天上下文：\n${context}`;
  const imageUrls = collectTrailingIncomingImageUrls(messages);
  if (!imageUrls.length) return prompt;

  const qwenContent: MessageContentComplex[] = [
    ...imageUrls.map(
      (url): MessageContentComplex => ({
        type: "image_url",
        image_url: { url },
      }),
    ),
    {
      type: "text",
      text: `${prompt}\n请结合好友刚刚发送的图片或表情包生成回复。`,
    },
  ];
  // ChatOpenAI's current standard image block is not converted by every
  // OpenAI-compatible provider. DashScope follows the legacy OpenAI
  // `image_url` wire format documented for Qwen multimodal chat.
  return qwenContent as unknown as MessageContent;
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
      new HumanMessage({ content: buildReplyUserContent(messages) }),
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
