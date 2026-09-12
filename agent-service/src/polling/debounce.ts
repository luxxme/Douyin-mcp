export type DebounceObservation = "waiting" | "ready";

type PendingMessage = {
  messageKey: string;
  readyAt: number;
};

export class MessageDebounceTracker {
  private readonly pending = new Map<string, PendingMessage>();

  constructor(private readonly debounceMs: number) {}

  observe(
    conversationId: string,
    messageKey: string,
    nowMs = Date.now(),
  ): DebounceObservation {
    const existing = this.pending.get(conversationId);
    if (!existing || existing.messageKey !== messageKey) {
      const readyAt = nowMs + this.debounceMs;
      this.pending.set(conversationId, { messageKey, readyAt });
      return this.debounceMs === 0 ? "ready" : "waiting";
    }
    return nowMs >= existing.readyAt ? "ready" : "waiting";
  }

  clear(conversationId: string): void {
    this.pending.delete(conversationId);
  }

  nextDelay(nowMs: number, fallbackMs: number): number {
    let delay = fallbackMs;
    for (const pending of this.pending.values()) {
      delay = Math.min(delay, Math.max(0, pending.readyAt - nowMs));
    }
    return delay;
  }

  get size(): number {
    return this.pending.size;
  }
}
