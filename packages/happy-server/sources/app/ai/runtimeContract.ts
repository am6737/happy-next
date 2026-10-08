import { AiRuntimeContractSchema, type AiRuntimeContract } from 'happy-wire';

export type { AiRuntimeContract };

export const WORK_ITEM_RUNTIME_CONTRACT: AiRuntimeContract = {
    kind: 'work_item', structuredFinalResponseVersion: 1, deliveryProofVersion: 1,
};

export const COORDINATOR_RUNTIME_CONTRACT: AiRuntimeContract = {
    kind: 'coordinator', structuredFinalResponseVersion: 1, deliveryProofVersion: 0,
};

export function readAiRuntimeContract(metadata: unknown): AiRuntimeContract | 'invalid' | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
        || !Object.prototype.hasOwnProperty.call(metadata, 'aiRuntimeContract')) return null;
    const value = (metadata as Record<string, unknown>).aiRuntimeContract;
    const parsed = AiRuntimeContractSchema.safeParse(value);
    return parsed.success ? parsed.data : 'invalid';
}

export function isLegacyCoordinator(metadata: unknown): boolean {
    return !!metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        && (metadata as Record<string, unknown>).coordinatorChat === true;
}
