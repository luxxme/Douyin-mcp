import { findLatestIncomingMessage } from "../processing/detectIncoming.js";
import type { ContactPolicy } from "../policy/contactPolicy.js";
import { isLoginExpiredError } from "./phase5.js";
import type { ProcessedMessageRepository } from "../store/processedMessageRepository.js";
import type { Conversation, ReadMessagesResult } from "../types/douyin.js";
import { createMessageKey } from "../utils/messageKey.js";
import { ConversationActivityTracker } from "./conversationActivity.js";
import type { MessageDebounceTracker } from "./debounce.js";

export type PollingDouyinClient = {
  listConversations(): Promise<Conversation[]>;
  readMessages(contact: string, limit: number): Promise<ReadMessagesResult>;
};

export type AutoReplyGraphRunner = {
  invoke(input: {
    conversation: Conversation;
    expectedMessageKey: string;
  }): Promise<{
    messageChangedDuringDebounce?: boolean | undefined;
    messageKey?: string | undefined;
    outcome?:
      | "dry_run"
      | "sent"
      | "skipped"
      | "rate_limited"
      | "failed"
      | "send_uncertain"
      | "already_processed"
      | "debounce_reset"
      | "login_expired"
      | undefined;
  }>;
};

export type PollCycleSummary = {
  conversations: number;
  policySkipped: number;
  activitySkipped: number;
  noIncoming: number;
  alreadyProcessed: number;
  debounceWaiting: number;
  debounceReset: number;
  processed: number;
  dryRuns: number;
  sent: number;
  skipped: number;
  rateLimited: number;
  sendUncertain: number;
  failed: number;
  loginExpired: boolean;
};

export async function runPollCycle(
  client: PollingDouyinClient,
  repository: ProcessedMessageRepository,
  policy: ContactPolicy,
  graph: AutoReplyGraphRunner,
  debounce: MessageDebounceTracker,
  messageLimit: number,
  nowMs = Date.now(),
  activityTracker?: ConversationActivityTracker,
): Promise<PollCycleSummary> {
  const summary: PollCycleSummary = {
    conversations: 0,
    policySkipped: 0,
    activitySkipped: 0,
    noIncoming: 0,
    alreadyProcessed: 0,
    debounceWaiting: 0,
    debounceReset: 0,
    processed: 0,
    dryRuns: 0,
    sent: 0,
    skipped: 0,
    rateLimited: 0,
    sendUncertain: 0,
    failed: 0,
    loginExpired: false,
  };

  let conversations: Conversation[];
  try {
    conversations = await client.listConversations();
  } catch (error) {
    if (isLoginExpiredError(error)) {
      summary.loginExpired = true;
      console.error("Douyin login session expired. Please re-login. Auto reply paused.");
      return summary;
    }
    throw error;
  }

  summary.conversations = conversations.length;
  const ordered = [...conversations].sort(
    (left, right) => Number(right.unread) - Number(left.unread),
  );

  for (const conversation of ordered) {
    if (!policy.decide(conversation.nickname).allowed) {
      summary.policySkipped += 1;
      debounce.clear(conversation.conversation_id);
      continue;
    }

    if (
      activityTracker &&
      !activityTracker.shouldInspect(
        conversation,
        debounce.has(conversation.conversation_id),
      )
    ) {
      summary.activitySkipped += 1;
      continue;
    }

    try {
      const result = await client.readMessages(conversation.nickname, messageLimit);
      activityTracker?.markOpened(conversation.conversation_id);
      const incoming = findLatestIncomingMessage(result.messages);
      if (!incoming) {
        summary.noIncoming += 1;
        debounce.clear(conversation.conversation_id);
        continue;
      }

      const messageKey = createMessageKey(conversation.conversation_id, incoming);
      if (repository.isProcessed(conversation.conversation_id, messageKey)) {
        summary.alreadyProcessed += 1;
        debounce.clear(conversation.conversation_id);
        continue;
      }

      if (debounce.observe(conversation.conversation_id, messageKey, nowMs) === "waiting") {
        summary.debounceWaiting += 1;
        console.log(`[debounce waiting] ${conversation.nickname}`);
        continue;
      }

      const resultState = await graph.invoke({
        conversation,
        expectedMessageKey: messageKey,
      });
      if (
        resultState.messageChangedDuringDebounce &&
        resultState.messageKey
      ) {
        debounce.observe(
          conversation.conversation_id,
          resultState.messageKey,
          Date.now(),
        );
        summary.debounceReset += 1;
        console.log(`[debounce reset] ${conversation.nickname}`);
        continue;
      }

      debounce.clear(conversation.conversation_id);
      if (resultState.outcome === "login_expired") {
        summary.loginExpired = true;
        console.error("Douyin login session expired. Please re-login. Auto reply paused.");
        break;
      }
      switch (resultState.outcome) {
        case "dry_run":
          summary.dryRuns += 1;
          summary.processed += 1;
          break;
        case "sent":
          summary.sent += 1;
          summary.processed += 1;
          break;
        case "skipped":
          summary.skipped += 1;
          summary.processed += 1;
          break;
        case "rate_limited":
          summary.rateLimited += 1;
          summary.processed += 1;
          break;
        case "send_uncertain":
          summary.sendUncertain += 1;
          summary.processed += 1;
          break;
        case "failed":
          summary.failed += 1;
          break;
        case "already_processed":
          summary.alreadyProcessed += 1;
          break;
        default:
          summary.processed += 1;
      }
    } catch (error) {
      if (isLoginExpiredError(error)) {
        summary.loginExpired = true;
        console.error("Douyin login session expired. Please re-login. Auto reply paused.");
        break;
      }
      summary.failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[poll conversation failed] ${conversation.nickname}: ${detail}`);
    }
  }

  return summary;
}

export async function sleepWithSignal(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || milliseconds <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runAutoReplyLoop(options: {
  client: PollingDouyinClient;
  repository: ProcessedMessageRepository;
  policy: ContactPolicy;
  graph: AutoReplyGraphRunner;
  debounce: MessageDebounceTracker;
  messageLimit: number;
  pollIntervalMs: number;
  signal: AbortSignal;
  maxCycles?: number;
  activityTracker?: ConversationActivityTracker;
}): Promise<void> {
  let cycle = 0;
  const activityTracker =
    options.activityTracker ?? new ConversationActivityTracker();
  while (!options.signal.aborted) {
    cycle += 1;
    console.log(`[poll start] cycle=${cycle}`);
    try {
      const summary = await runPollCycle(
        options.client,
        options.repository,
        options.policy,
        options.graph,
        options.debounce,
        options.messageLimit,
        Date.now(),
        activityTracker,
      );
      console.log("[poll complete]", summary);
      if (summary.loginExpired) return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[poll failed] ${detail}`);
    }

    if (options.maxCycles !== undefined && cycle >= options.maxCycles) return;
    const delay = options.debounce.nextDelay(Date.now(), options.pollIntervalMs);
    await sleepWithSignal(delay, options.signal);
  }
}
