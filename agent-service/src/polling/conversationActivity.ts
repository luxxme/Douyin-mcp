import type { Conversation } from "../types/douyin.js";

function activitySignature(conversation: Conversation): string {
  return JSON.stringify([
    conversation.last_message,
    conversation.timestamp,
    conversation.unread,
    conversation.unread_count,
  ]);
}

/**
 * Avoid reopening every allowlisted conversation on every polling cycle.
 *
 * The first observation is intentionally inspected so an incoming message that
 * predates process startup is not lost. Afterwards we inspect conversations
 * whose list-row activity changed, unread conversations, debounce candidates,
 * and the conversation that the controller most recently opened. Keeping the
 * last-opened conversation hot also catches messages that Douyin does not mark
 * unread while its chat panel is visible.
 */
export class ConversationActivityTracker {
  private readonly signatures = new Map<string, string>();
  private lastOpenedConversationId?: string;

  shouldInspect(conversation: Conversation, debouncePending = false): boolean {
    const signature = activitySignature(conversation);
    const previous = this.signatures.get(conversation.conversation_id);
    this.signatures.set(conversation.conversation_id, signature);

    return (
      previous === undefined ||
      previous !== signature ||
      conversation.unread ||
      debouncePending ||
      this.lastOpenedConversationId === conversation.conversation_id
    );
  }

  markOpened(conversationId: string): void {
    this.lastOpenedConversationId = conversationId;
  }
}
