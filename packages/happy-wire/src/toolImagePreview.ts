import { z } from 'zod';

export const openToolImagePreviewRequestSchema = z.object({
    callId: z.string().min(1).max(512),
}).strict();

export type OpenToolImagePreviewRequest = z.infer<typeof openToolImagePreviewRequestSchema>;
