import * as z from 'zod';

export const SessionAttachmentsCapabilitySchema = z.object({
  version: z.literal(2),
  maxFiles: z.number().int().positive(),
  maxFileSize: z.number().int().positive(),
});

export type SessionAttachmentsCapability = z.infer<typeof SessionAttachmentsCapabilitySchema>;
