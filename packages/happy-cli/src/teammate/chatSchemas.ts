import { z } from 'zod';
import { ChannelMessageBodySchema } from 'happy-wire';

export const ChatSendSchema = ChannelMessageBodySchema.extend({
    kind: z.enum(['text', 'decision', 'report']).default('text'),
    mentions: z.array(z.string()).max(20).optional(),
    channelId: z.string().optional(),
});
export const ChatHistorySchema = z.object({
    limit: z.number().int().min(1).max(200).optional(),
    beforeSeq: z.number().int().min(1).optional(),
});
export const ChatAuthSchema = z.object({ threadId: z.string().min(1), controlToken: z.string().min(1).max(256) });
export const ChatSendRequestSchema = ChatAuthSchema.merge(ChatSendSchema);
export const ChatHistoryRequestSchema = ChatAuthSchema.merge(ChatHistorySchema);
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;
export type ChatHistoryRequest = z.infer<typeof ChatHistoryRequestSchema>;
