import type { DouyinMessage } from "../types/douyin.js";

export function findLatestIncomingMessage(
  messages: readonly DouyinMessage[],
): DouyinMessage | undefined {
  return findTrailingIncomingMessages(messages).at(-1);
}

export function findTrailingIncomingMessages(
  messages: readonly DouyinMessage[],
): DouyinMessage[] {
  const incoming: DouyinMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.sender === "system") {
      continue;
    }
    if (message.sender === "me") {
      break;
    }
    if (message.content.trim()) incoming.push(message);
  }
  return incoming.reverse();
}
