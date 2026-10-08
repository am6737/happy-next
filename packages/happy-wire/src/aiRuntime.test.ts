import { describe, expect, it } from 'vitest';
import { AiRuntimeContractSchema, AiRuntimeFeaturesSchema, AiRuntimeResultProjectionSchema } from './aiRuntime';

describe('AI runtime compatibility boundaries', () => {
    it('distinguishes a coordinator answer from a work item delivery contract', () => {
        expect(AiRuntimeContractSchema.parse({ kind: 'coordinator', structuredFinalResponseVersion: 1,
            deliveryProofVersion: 0 }).deliveryProofVersion).toBe(0);
        expect(AiRuntimeContractSchema.parse({ kind: 'work_item', structuredFinalResponseVersion: 1,
            deliveryProofVersion: 1 }).deliveryProofVersion).toBe(1);
        for (const contract of [
            { kind: 'work_item', structuredFinalResponseVersion: 1, deliveryProofVersion: 0 },
            { kind: 'coordinator', structuredFinalResponseVersion: 1, deliveryProofVersion: 1 },
            { kind: 'coordinator', structuredFinalResponseVersion: 2, deliveryProofVersion: 0 },
            { kind: 'coordinator', structuredFinalResponseVersion: 1, deliveryProofVersion: 0, origin: 'generic' },
        ]) expect(AiRuntimeContractSchema.safeParse(contract).success).toBe(false);
    });

    it('does not interpret an old v1 feature envelope as current answer support', () => {
        const old = { nonce: 'nonce', machineId: 'machine', protocolVersion: 1, executionCapabilityVersion: 1 };
        expect(AiRuntimeFeaturesSchema.safeParse(old).success).toBe(false);
        const current = { ...old, structuredFinalResponseVersion: 1, deliveryProofVersion: 1 };
        expect(AiRuntimeFeaturesSchema.parse(current).nonce).toBe('nonce');
        expect(AiRuntimeFeaturesSchema.safeParse({ ...current, nonce: '' }).success).toBe(false);
        expect(AiRuntimeFeaturesSchema.safeParse({ ...current, deliveryProofVersion: 0 }).success).toBe(false);
        // Approval support is separate from ordinary structured replies.
        expect(AiRuntimeFeaturesSchema.safeParse({ ...current, approval: {
            provider: 'claude', runner: 'app-server', operationDecisionVersion: 1 } }).success).toBe(false);
    });

    it('cannot mark absent or whitespace-only replies as verified', () => {
        for (const finalResponse of [null, '', '   ']) expect(AiRuntimeResultProjectionSchema.safeParse({
            finalResponse, answerVerified: true, deliveryVerified: null }).success).toBe(false);
        expect(AiRuntimeResultProjectionSchema.parse({ finalResponse: 'Answer', answerVerified: true,
            deliveryVerified: false }).deliveryVerified).toBe(false);
        expect(AiRuntimeResultProjectionSchema.parse({ finalResponse: null, answerVerified: false,
            deliveryVerified: null }).answerVerified).toBe(false);
        expect(AiRuntimeResultProjectionSchema.safeParse({ finalResponse: 'Answer',
            deliveryVerified: true }).success).toBe(false);
    });
});
