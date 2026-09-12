import type { DouyinMessage } from "../types/douyin.js";

export function findLatestIncomingMessage(
  messages: readonly DouyinMessage[],
): DouyinMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.sender === "system") {
      continue;
    }
    if (message.sender === "me") {
      return undefined;
    }
    return message.content.trim() ? message : undefined;
  }
  return undefined;
}
