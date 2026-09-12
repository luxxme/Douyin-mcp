import { createHash } from "node:crypto";

import type { DouyinMessage } from "../types/douyin.js";

type MessageKeyInput = Pick<
  DouyinMessage,
  "sender" | "content" | "timestamp" | "type" | "media_url"
> & {
  id?: string | null;
};

export function createMessageKey(
  conversationId: string,
  message: MessageKeyInput,
): string {
  const id = message.id?.trim();
  if (id) {
    return id;
  }

  const fingerprint = [
    conversationId,
    message.sender,
    message.content,
    message.timestamp ?? "",
    message.type,
    message.media_url ?? "",
  ].join("\u001f");

  return `sha256:${createHash("sha256").update(fingerprint).digest("hex")}`;
}
