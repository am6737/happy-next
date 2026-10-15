import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createOrchestratorEnvelopeOpener, openOrchestrator, openOrchestratorResponse, sealOrchestrator, sealTitle } from './seal';

const tempDir = mkdtempSync(join(tmpdir(), 'happy-seal-test-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const key = new Uint8Array(32).fill(1);
const otherKey = new Uint8Array(32).fill(2);

function opener(machineId = 'machine-1') {
    return createOrchestratorEnvelopeOpener({
        loadKey: async () => key,
        machineId,
        seenFile: join(mkdtempSync(join(tempDir, 'seen-')), 'seals.json'),
    });
}

function taskEnvelope(overrides: Record<string, unknown> = {}) {
    return sealOrchestrator({
        kind: 'task', sealId: 'seal-1', createdAt: Date.now(), machineIds: ['machine-1'], maxAttempts: 2,
        provider: 'claude', prompt: 'do it', workingDirectory: '/work', ...overrides,
    }, key);
}

describe('orchestrator sealing', () => {
    it('opens only what was sealed with the same key', () => {
        const sealed = sealOrchestrator({ title: 'hello' }, key);
        expect(sealed.startsWith('e2e1:')).toBe(true);
        expect(openOrchestrator(sealed, key)).toEqual({ title: 'hello' });
        expect(openOrchestrator(sealed, otherKey)).toBeNull();
        expect(openOrchestrator('plain text', key)).toBeNull();
    });
});

describe('orchestrator envelope opener', () => {
    it('opens a task for this machine and refuses one of another kind, machine or key', async () => {
        const { open } = opener();
        const base = { executionId: 'exec-1', taskId: 'task-1', executionType: 'initial' as const };
        expect((await open('task', { ...base, prompt: taskEnvelope() })).envelope).toMatchObject({ prompt: 'do it', workingDirectory: '/work' });
        await expect(open('shell', { ...base, prompt: taskEnvelope() })).rejects.toThrow('not sealed');
        await expect(open('task', { ...base, prompt: taskEnvelope({ sealId: 's2', machineIds: ['machine-2'] }) })).rejects.toThrow('not sent to this machine');
        await expect(open('task', { ...base, prompt: sealOrchestrator({ kind: 'task' }, otherKey) })).rejects.toThrow('not sealed');
        await expect(open('task', { ...base, prompt: taskEnvelope({ sealId: 's3', createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }) })).rejects.toThrow('too long ago');
    });

    it('lets an envelope run as many executions as its attempts, and the same execution again', async () => {
        const { open } = opener();
        const prompt = taskEnvelope();
        await open('task', { executionId: 'exec-1', taskId: 'task-1', prompt });
        await open('task', { executionId: 'exec-1', taskId: 'task-1', prompt });
        await open('task', { executionId: 'exec-2', taskId: 'task-1', prompt });
        await expect(open('task', { executionId: 'exec-3', taskId: 'task-1', prompt })).rejects.toThrow('already ran');
    });

    it('runs a follow-up once, and only for the task it was sealed for', async () => {
        const { open } = opener();
        const resumeMessage = sealOrchestrator({ kind: 'resume', sealId: 'resume-1', taskId: 'task-1', message: 'more', createdAt: Date.now() }, key);
        const resume = { taskId: 'task-1', executionType: 'resume' as const, prompt: taskEnvelope(), resumeMessage };
        expect((await open('task', { ...resume, executionId: 'exec-r1' })).resumeMessage).toBe('more');
        await expect(open('task', { ...resume, executionId: 'exec-r2' })).rejects.toThrow('already ran');
        await expect(open('task', { ...resume, executionId: 'exec-r3', taskId: 'task-2' })).rejects.toThrow('for this task');
    });

    it('serves a transfer only from the machine it names as source', async () => {
        const spec = sealOrchestrator({
            kind: 'transfer', sealId: 'seal-t', createdAt: Date.now(), machineIds: ['machine-2'], maxAttempts: 1,
            sourceMachineId: 'machine-1', sourcePath: '/a', targetPath: '/b', overwrite: false,
        }, key);
        expect(await opener('machine-1').openSource(spec)).toMatchObject({ sourcePath: '/a' });
        await expect(opener('machine-2').openSource(spec)).rejects.toThrow('Transfer refused');
    });
});

describe('orchestrator responses', () => {
    it('opens titles, prompts, results and follow-ups in the shape they had before sealing', () => {
        const result = (taskId: string, executionId: string) => sealOrchestrator({
            kind: 'result', taskId, executionId, outputSummary: 'sum', outputText: 'out', stderrText: 'err', errorMessage: null,
        }, key);
        const response = openOrchestratorResponse({
            ok: true,
            data: {
                title: sealTitle('Run', { a: 1 }, key),
                tasks: [{
                    taskId: 'task-1', title: sealTitle('Task', undefined, key), prompt: taskEnvelope(), outputSummary: null, outputText: null,
                    errorMessage: null, sealedResult: result('task-1', 'exec-1'),
                    executions: [
                        { executionId: 'exec-1', resumeMessage: null, outputText: null, sealedResult: result('task-1', 'exec-1') },
                        // Moved over from another execution by the server
                        { executionId: 'exec-2', resumeMessage: null, outputText: null, sealedResult: result('task-1', 'exec-1') },
                    ],
                }],
            },
        }, key);
        expect(response.data.title).toBe('Run');
        expect(response.data.tasks[0]).toMatchObject({ title: 'Task', prompt: 'do it', workingDirectory: '/work', outputSummary: 'sum', outputText: 'out' });
        expect(response.data.tasks[0]).not.toHaveProperty('stdout');
        expect(response.data.tasks[0].executions[0]).toMatchObject({ outputText: 'out' });
        expect(response.data.tasks[0].executions[1]).toMatchObject({ outputText: null, errorMessage: expect.stringContaining('cannot be decrypted') });
    });

    it('shows a shell task its stdout and a transfer its from and to', () => {
        const shell = sealOrchestrator({ kind: 'shell', sealId: 's', createdAt: 0, machineIds: 'all', maxAttempts: 1, command: 'ls' }, key);
        const transfer = sealOrchestrator({
            kind: 'transfer', sealId: 't', createdAt: 0, machineIds: 'all', maxAttempts: 1,
            sourceMachineId: 'm1', sourcePath: '/a', targetPath: '/b', overwrite: false,
        }, key);
        const response = openOrchestratorResponse({
            ok: true,
            data: {
                tasks: [
                    { taskId: 'task-1', prompt: shell, stdout: null, stderr: null, sealedResult: sealOrchestrator({ kind: 'result', taskId: 'task-1', executionId: 'e', outputText: 'files' }, key) },
                    { taskId: 'task-2', prompt: transfer, result: null, sealedResult: null },
                ],
            },
        }, key);
        expect(response.data.tasks[0]).toMatchObject({ prompt: 'ls', stdout: 'files' });
        expect(response.data.tasks[1]).toMatchObject({ from: { machineId: 'm1', path: '/a' }, to: '/b', result: null });
        expect(response.data.tasks[1].prompt).toBeUndefined();
    });

    it('marks what another key sealed as unreadable', () => {
        const response = openOrchestratorResponse({ ok: true, data: { items: [{ runId: 'r', title: sealTitle('x', undefined, otherKey) }] } }, key);
        expect(response.data.items[0].title).toContain('cannot be decrypted');
    });
});
