import * as z from 'zod';
import { MessageMetaSchema } from './messageMeta';

export const ImageContentSchema = z.object({
  type: z.literal('image'),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  mimeType: z.string(),
  thumbhash: z.string().optional(),
});
export type ImageContent = z.infer<typeof ImageContentSchema>;

const LegacyAttachmentContentSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  kind: z.enum(['image', 'file']),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(25 * 1024 * 1024),
  image: z.object({
    width: z.number(),
    height: z.number(),
    thumbhash: z.string().optional(),
  }).optional(),
}).passthrough();

const EncryptedAttachmentContentSchema = z.object({
  v: z.literal(2),
  id: z.string(),
  kind: z.enum(['image', 'file']),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(25 * 1024 * 1024),
  encryption: z.object({
    algorithm: z.literal('secretbox'),
    key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
    plaintextSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ciphertextSize: z.number().int().positive().max(25 * 1024 * 1024 + 16),
  }),
  image: z.object({
    width: z.number(),
    height: z.number(),
    thumbhash: z.string().optional(),
  }).optional(),
}).passthrough();

export const AttachmentContentSchema = z.discriminatedUnion('v', [
  LegacyAttachmentContentSchema,
  EncryptedAttachmentContentSchema,
]);
export type AttachmentContent = z.infer<typeof AttachmentContentSchema>;

export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({
      type: z.literal('mixed'),
      text: z.string(),
      images: z.array(ImageContentSchema).optional(),
      attachments: z.array(AttachmentContentSchema).optional(),
    }).passthrough(),
  ]),
  localKey: z.string().optional(),
  meta: MessageMetaSchema.optional(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AgentMessageSchema = z.object({
  role: z.literal('agent'),
  content: z
    .object({
      type: z.string(),
    })
    .passthrough(),
  meta: MessageMetaSchema.optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const LegacyMessageContentSchema = z.discriminatedUnion('role', [UserMessageSchema, AgentMessageSchema]);
export type LegacyMessageContent = z.infer<typeof LegacyMessageContentSchema>;
