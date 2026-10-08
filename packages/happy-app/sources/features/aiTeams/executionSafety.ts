import type { AiExecutionStatus } from './types';

const nonRetryableErrors = new Set([
    'APPROVAL_SESSION_INTERRUPTED',
    'APPROVAL_OUTCOME_UNCERTAIN',
    'UPGRADE_REQUIRED',
]);

export function canRetryAiExecution(status: AiExecutionStatus, errorCode: string | null | undefined,
    hasWorkItem: boolean): boolean {
    return hasWorkItem && status === 'failed' && typeof errorCode === 'string'
        && errorCode.length > 0 && !nonRetryableErrors.has(errorCode);
}
