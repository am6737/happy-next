import { describe, expect, it } from 'vitest';
import {
    formatOrchestratorProviderLabel,
    pickLatestAssistantMessage,
    resolveTaskMachineId,
    resolveExecutionDurationMs,
    resolveMachineName,
    resolveOrchestratorAttemptDisplay,
    resolveOrchestratorExecutionPrompt,
    resolveOrchestratorSummaryLineData,
    resolveRunDurationMs,
    resolveTaskDurationMs,
    sanitizeOrchestratorOutputSummary,
    shortenMachineId,
    sortOrchestratorExecutionsByAttemptDesc,
} from './display';

describe('orchestrator display helpers', () => {
    it('appends model after provider when model exists', () => {
        expect(formatOrchestratorProviderLabel({ provider: 'codex', model: 'gpt-5.3-codex-medium' })).toBe('codex · gpt-5.3-codex-medium');
        expect(formatOrchestratorProviderLabel({ provider: 'claude', model: null })).toBe('claude · default');
    });

    it('keeps attempt denominator at least current executions', () => {
        expect(resolveOrchestratorAttemptDisplay({
            retry: { maxAttempts: 1, backoffMs: 0 },
            executions: [{ executionId: 'e1', attempt: 1 }, { executionId: 'e2', attempt: 2 }] as any,
        })).toEqual({
            current: 2,
            max: 2,
        });
    });

    it('uses max execution attempt when count is lower than attempt number', () => {
        expect(resolveOrchestratorAttemptDisplay({
            retry: { maxAttempts: 1, backoffMs: 0 },
            executions: [{ executionId: 'e2', attempt: 2 }] as any,
        })).toEqual({
            current: 2,
            max: 2,
        });
    });

    it('removes standalone markdown fences from output summary', () => {
        expect(sanitizeOrchestratorOutputSummary('```')).toBeNull();
        expect(sanitizeOrchestratorOutputSummary('```json\nhello\n```')).toBe('hello');
        expect(sanitizeOrchestratorOutputSummary('done')).toBe('done');
    });

    it('sorts execution records by attempt desc', () => {
        const sorted = sortOrchestratorExecutionsByAttemptDesc([
            { executionId: 'e1', attempt: 1 },
            { executionId: 'e3', attempt: 3 },
            { executionId: 'e2', attempt: 2 },
        ] as any);
        expect(sorted.map((item) => item.executionId)).toEqual(['e3', 'e2', 'e1']);
    });

    it('uses resume message as the execution prompt when present', () => {
        expect(resolveOrchestratorExecutionPrompt('initial prompt', { resumeMessage: 'follow up' })).toBe('follow up');
        expect(resolveOrchestratorExecutionPrompt('initial prompt', { resumeMessage: null })).toBe('initial prompt');
        expect(resolveOrchestratorExecutionPrompt(null, { resumeMessage: null })).toBeNull();
    });

    it('includes queued tasks in running summary line display', () => {
        expect(resolveOrchestratorSummaryLineData({
            total: 3,
            queued: 1,
            running: 1,
            completed: 1,
            failed: 0,
            cancelled: 0,
        })).toEqual({
            total: 3,
            running: 2,
            completed: 1,
            failed: 0,
            cancelled: 0,
        });
    });

    it('returns latest active execution machine for running tasks', () => {
        expect(resolveTaskMachineId({
            status: 'running',
            executions: [
                { machineId: 'machine-a', status: 'completed' },
                { machineId: 'machine-b', status: 'running' },
            ],
        } as any)).toBe('machine-b');
    });

    it('returns last execution machine for non-active tasks', () => {
        expect(resolveTaskMachineId({
            status: 'completed',
            executions: [
                { machineId: 'machine-a', status: 'running' },
                { machineId: 'machine-b', status: 'completed' },
            ],
        } as any)).toBe('machine-b');
    });

    it('returns null when no execution exists', () => {
        expect(resolveTaskMachineId({ status: 'queued', executions: undefined } as any)).toBeNull();
        expect(resolveTaskMachineId({ status: 'queued', executions: [] } as any)).toBeNull();
    });

    it('shortens machine id to first 8 chars', () => {
        expect(shortenMachineId('123456789abc')).toBe('12345678');
        expect(shortenMachineId('12345678')).toBe('12345678');
        expect(shortenMachineId('abcd')).toBe('abcd');
    });

    it('resolves machine name with shortened id for disambiguation', () => {
        const nameMap = new Map([['id-aaa-bbb', 'My Mac']]);
        expect(resolveMachineName('id-aaa-bbb', nameMap)).toBe('My Mac (id-aaa-b)');
        expect(resolveMachineName('id-aaa-unknown', nameMap)).toBe('id-aaa-u');
    });

    it('picks the latest non-empty assistant message', () => {
        expect(pickLatestAssistantMessage([
            { role: 'user', content: 'do it' },
            { role: 'assistant', content: 'first step' },
            { role: 'assistant', content: '  second step \n' },
            { role: 'user', content: 'ignored' },
        ])).toBe('second step');
        expect(pickLatestAssistantMessage([
            { role: 'assistant', content: 'kept' },
            { role: 'assistant', content: '   ' },
        ])).toBe('kept');
        expect(pickLatestAssistantMessage([{ role: 'user', content: 'only prompt' }])).toBeNull();
        expect(pickLatestAssistantMessage([])).toBeNull();
    });

    describe('durations', () => {
        const at = (iso: string) => Date.parse(iso);
        const execution = (overrides: Record<string, unknown>) => ({
            status: 'completed',
            startedAt: '2026-05-20T10:00:00.000Z',
            finishedAt: '2026-05-20T10:03:12.000Z',
            updatedAt: '2026-05-20T10:03:13.000Z',
            ...overrides,
        }) as any;

        it('measures a finished execution from start to finish', () => {
            expect(resolveExecutionDurationMs(execution({}), at('2026-05-20T12:00:00.000Z'))).toBe(192_000);
        });

        it('measures a running execution up to now', () => {
            expect(resolveExecutionDurationMs(execution({ status: 'running', finishedAt: null }), at('2026-05-20T10:00:42.000Z'))).toBe(42_000);
        });

        it('falls back to the last update when a finished execution has no finish time', () => {
            expect(resolveExecutionDurationMs(execution({ finishedAt: null }), at('2026-05-20T12:00:00.000Z'))).toBe(193_000);
        });

        it('has no duration before the execution started, and never goes negative', () => {
            expect(resolveExecutionDurationMs(execution({ status: 'dispatching', startedAt: null, finishedAt: null }), Date.now())).toBeNull();
            expect(resolveExecutionDurationMs(execution({ status: 'running', finishedAt: null }), at('2026-05-20T09:00:00.000Z'))).toBe(0);
        });

        it('adds up the attempts of a task and ignores those that never started', () => {
            const now = at('2026-05-20T11:00:00.000Z');
            expect(resolveTaskDurationMs({ executions: [
                execution({}),
                execution({ startedAt: '2026-05-20T10:10:00.000Z', finishedAt: '2026-05-20T10:10:30.000Z' }),
                execution({ status: 'dispatching', startedAt: null, finishedAt: null }),
            ] }, now)).toBe(222_000);
            expect(resolveTaskDurationMs({ executions: [] }, now)).toBeNull();
            expect(resolveTaskDurationMs({ executions: undefined }, now)).toBeNull();
        });

        it('measures a run from creation up to now while active and up to completion once ended', () => {
            const run = { createdAt: '2026-05-20T10:00:00.000Z', updatedAt: '2026-05-20T10:09:00.000Z', completedAt: '2026-05-20T10:08:00.000Z' };
            expect(resolveRunDurationMs({ ...run, status: 'running', completedAt: null }, at('2026-05-20T10:05:00.000Z'))).toBe(300_000);
            expect(resolveRunDurationMs({ ...run, status: 'completed' }, at('2026-05-20T12:00:00.000Z'))).toBe(480_000);
            expect(resolveRunDurationMs({ ...run, status: 'cancelled', completedAt: null }, at('2026-05-20T12:00:00.000Z'))).toBe(540_000);
        });
    });
});
