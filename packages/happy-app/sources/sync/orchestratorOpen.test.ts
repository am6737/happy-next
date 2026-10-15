import { describe, expect, it, vi } from 'vitest';
import type { Encryption } from './encryption/encryption';
import { openOrchestratorTask, openOrchestratorTitle, type SealedTaskRecord } from './orchestratorOpen';

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

// Stands in for the orchestrator key: a sealed value opens to what the map holds for it
function fakeEncryption(sealed: Record<string, unknown>): Encryption {
    return {
        openOrchestrator: async (values: unknown[]) => values.map((value) => typeof value === 'string' ? sealed[value] ?? null : null),
    } as unknown as Encryption;
}

function task(overrides: Partial<SealedTaskRecord> = {}): SealedTaskRecord {
    return {
        taskId: 'task-1', seq: 0, taskKey: null, title: 'e2e1:title', status: 'completed', provider: 'claude', model: null,
        prompt: 'e2e1:prompt', workingDirectory: null, dependsOn: [], retry: { maxAttempts: 1, backoffMs: 0 }, nextAttemptAt: null,
        outputSummary: null, outputText: null, stderrText: null, sealedResult: 'e2e1:result', errorCode: null, errorMessage: null,
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

const execution = {
    executionId: 'exec-1', attempt: 1, status: 'completed' as const, machineId: 'm', provider: 'claude' as const, model: null,
    childSessionId: null, executionType: 'resume' as const, resumeMessage: 'e2e1:resume', startedAt: null, finishedAt: null,
    exitCode: 0, signal: null, errorCode: null, errorMessage: null, outputSummary: null, outputText: null,
    sealedResult: 'e2e1:exec-result', createdAt: '', updatedAt: '',
};

describe('openOrchestratorTask', () => {
    it('opens the title, what the task does, its result and follow-ups', async () => {
        const opened = await openOrchestratorTask(task({ executions: [execution] }), fakeEncryption({
            'e2e1:title': { title: 'Review' },
            'e2e1:prompt': { kind: 'task', prompt: 'review it', workingDirectory: '/repo' },
            'e2e1:result': { kind: 'result', taskId: 'task-1', executionId: 'exec-1', outputSummary: 'done', outputText: 'all good' },
            'e2e1:resume': { kind: 'resume', taskId: 'task-1', message: 'and the tests' },
            'e2e1:exec-result': { kind: 'result', taskId: 'task-1', executionId: 'exec-1', outputText: 'tests pass' },
        }));
        expect(opened).toMatchObject({ title: 'Review', prompt: 'review it', workingDirectory: '/repo', outputSummary: 'done', outputText: 'all good' });
        expect(opened).not.toHaveProperty('sealedResult');
        expect(opened.executions?.[0]).toMatchObject({ resumeMessage: 'and the tests', outputText: 'tests pass' });
    });

    it('shows a transfer\'s envelope as its spec, and marks what does not open or belongs elsewhere', async () => {
        const opened = await openOrchestratorTask(task({ provider: 'transfer', executions: [execution] }), fakeEncryption({
            'e2e1:prompt': { kind: 'transfer', sourceMachineId: 'a', sourcePath: '/x', targetPath: '/y', overwrite: false },
            'e2e1:result': { kind: 'result', taskId: 'task-2', executionId: 'exec-9', outputText: 'moved here' },
            'e2e1:resume': { kind: 'resume', taskId: 'task-2', message: 'redirected' },
        }));
        expect(JSON.parse(opened.prompt!)).toEqual({ sourceMachineId: 'a', sourcePath: '/x', targetPath: '/y', overwrite: false });
        expect(opened).toMatchObject({ title: 'settings.orchestratorUndecryptable', outputText: null, errorMessage: 'settings.orchestratorUndecryptable' });
        expect(opened.executions?.[0]).toMatchObject({ resumeMessage: 'settings.orchestratorUndecryptable', errorMessage: 'settings.orchestratorUndecryptable' });
    });

    it('leaves a title that was never sealed as it is', async () => {
        expect(await openOrchestratorTitle(null, fakeEncryption({}))).toBeNull();
        expect(await openOrchestratorTitle('e2e1:x', fakeEncryption({ 'e2e1:x': { title: 'Run' } }))).toBe('Run');
    });
});
