import { z } from "zod";

export const ConversationSchema = z.object({
  conversation_id: z.string().min(1),
  user_id: z.string().nullable(),
  nickname: z.string().min(1),
  last_message: z.string(),
  unread: z.boolean(),
  unread_count: z.number().int().nonnegative(),
  timestamp: z.string().nullable(),
});

export const ConversationListResultSchema = z.object({
  conversations: z.array(ConversationSchema),
  count: z.number().int().nonnegative(),
});

export const DouyinMessageSchema = z.object({
  id: z.string().min(1),
  sender: z.enum(["me", "friend", "system"]),
  sender_name: z.string().nullable(),
  content: z.string(),
  timestamp: z.string().nullable(),
  type: z.enum(["text", "image", "video", "other"]),
  media_url: z.string().min(1).nullable().optional(),
});

export const ReadMessagesResultSchema = z.object({
  conversation_id: z.string().min(1),
  user_id: z.string().nullable(),
  nickname: z.string().min(1),
  messages: z.array(DouyinMessageSchema),
  count: z.number().int().nonnegative(),
});

export const SendMessageResultSchema = z.object({
  ok: z.boolean(),
  recipient: z.string(),
  status: z.enum(["sent", "drafted", "failed"]),
  detail: z.string(),
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type DouyinMessage = z.infer<typeof DouyinMessageSchema>;
export type ReadMessagesResult = z.infer<typeof ReadMessagesResultSchema>;
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;
