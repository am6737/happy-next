import { describe, expect, it } from 'vitest';
import { canRetryAiExecution } from './executionSafety';

describe('AI execution retry safety', () => {
    it('blocks upgrade and approval safety failures', () => {
        for (const code of ['UPGRADE_REQUIRED', 'APPROVAL_SESSION_INTERRUPTED', 'APPROVAL_OUTCOME_UNCERTAIN']) {
            expect(canRetryAiExecution('failed', code, true)).toBe(false);
        }
    });

    it('blocks absent error projection and executions without a WorkItem', () => {
        expect(canRetryAiExecution('failed', undefined, true)).toBe(false);
        expect(canRetryAiExecution('failed', null, true)).toBe(false);
        expect(canRetryAiExecution('failed', 'PROCESS_EXIT_NON_ZERO', false)).toBe(false);
        expect(canRetryAiExecution('completed', 'PROCESS_EXIT_NON_ZERO', true)).toBe(false);
    });

    it('keeps ordinary known provider failures explicitly retryable', () => {
        expect(canRetryAiExecution('failed', 'PROCESS_EXIT_NON_ZERO', true)).toBe(true);
    });
});
