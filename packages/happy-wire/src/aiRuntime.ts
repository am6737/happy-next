import { z } from 'zod';

// Frozen by the Server, never inferred from a prompt or package version.
export const AiRuntimeContractSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('work_item'), structuredFinalResponseVersion: z.literal(1),
        deliveryProofVersion: z.literal(1) }).strict(),
    z.object({ kind: z.literal('coordinator'), structuredFinalResponseVersion: z.literal(1),
        deliveryProofVersion: z.literal(0) }).strict(),
]);

// A valid shape still requires the caller to match its nonce and machine.
export const AiRuntimeFeaturesSchema = z.object({
    nonce: z.string().min(1).max(256), machineId: z.string().min(1).max(256),
    protocolVersion: z.literal(1), executionCapabilityVersion: z.literal(1),
    structuredFinalResponseVersion: z.literal(1), deliveryProofVersion: z.literal(1),
    approval: z.object({ provider: z.literal('codex'), runner: z.literal('app-server'),
        operationDecisionVersion: z.literal(1) }).strict().optional(),
}).passthrough();

// Execution completion and delivery verification are independent facts.
// Older responses may omit these fields; callers must not infer true.
export const AiRuntimeResultProjectionSchema = z.object({
    finalResponse: z.string().max(65_536).nullable(), answerVerified: z.boolean(),
    deliveryVerified: z.boolean().nullable(),
}).superRefine((result, context) => {
    if (result.answerVerified && !result.finalResponse?.trim()) {
        context.addIssue({ code: z.ZodIssueCode.custom,
            message: 'A verified answer requires an explicit final response', path: ['finalResponse'] });
    }
});

export type AiRuntimeContract = z.infer<typeof AiRuntimeContractSchema>;
export type AiRuntimeFeatures = z.infer<typeof AiRuntimeFeaturesSchema>;
export type AiRuntimeResultProjection = z.infer<typeof AiRuntimeResultProjectionSchema>;
