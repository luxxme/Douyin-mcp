import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import { ConversationSchema, DouyinMessageSchema } from "../types/douyin.js";

export const GraphOutcomeSchema = z.enum([
  "dry_run",
  "sent",
  "skipped",
  "rate_limited",
  "failed",
  "send_uncertain",
  "already_processed",
  "debounce_reset",
  "login_expired",
]);

export const AutoReplyStateSchema = new StateSchema({
  conversation: ConversationSchema,
  expectedMessageKey: z.string().optional(),
  messages: z.array(DouyinMessageSchema).default(() => []),
  incomingBatch: z.array(DouyinMessageSchema).default(() => []),
  latestIncomingMessage: DouyinMessageSchema.optional(),
  messageKey: z.string().optional(),
  messageChangedDuringDebounce: z.boolean().default(false),
  alreadyProcessed: z.boolean().default(false),
  shouldReply: z.boolean().default(false),
  replyText: z.string().optional(),
  reason: z.string().optional(),
  outcome: GraphOutcomeSchema.optional(),
});

export type AutoReplyState = typeof AutoReplyStateSchema.State;
