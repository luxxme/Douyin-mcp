import type { ProcessedMessageRepository } from "../store/processedMessageRepository.js";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "global_per_minute" | "contact_per_hour" };

export class ReplyRateLimiter {
  constructor(
    private readonly repository: ProcessedMessageRepository,
    private readonly maxPerMinute: number,
    private readonly maxPerContactPerHour: number,
  ) {}

  check(conversationId: string, now = new Date()): RateLimitDecision {
    const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
    if (this.repository.countSendAttemptsSince(minuteAgo) >= this.maxPerMinute) {
      return { allowed: false, reason: "global_per_minute" };
    }

    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    if (
      this.repository.countSendAttemptsSince(hourAgo, conversationId) >=
      this.maxPerContactPerHour
    ) {
      return { allowed: false, reason: "contact_per_hour" };
    }

    return { allowed: true };
  }
}
