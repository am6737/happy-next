import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEAMMATE_ENV } from 'happy-wire';
import { mergeThreadState, readThreadsState } from './homeDir';
import { isClaudeContextOverflow, recordTeammateCompaction, recordTeammateContextUsage, recordTeammateOverflow } from './contextSignals';

const homes: string[] = [];
afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function controller() {
    const home = await mkdtemp(join(tmpdir(), 'happy-context-'));
    homes.push(home);
    vi.stubEnv(TEAMMATE_ENV.sessionRole, 'controller');
    vi.stubEnv(TEAMMATE_ENV.home, home);
    vi.stubEnv(TEAMMATE_ENV.threadId, 'thread');
    await mergeThreadState(home, 'thread', { lastRunId: 'run', lastDispatchToken: 'token' });
    return { home, entry: async () => (await readThreadsState(home)).thread };
}

describe('teammate context signals', () => {
    it('does nothing outside a controller session', async () => {
        const { home } = await controller();
        vi.stubEnv(TEAMMATE_ENV.sessionRole, 'worker');
        const api = { reportTeammateContextEvent: vi.fn() };
        await recordTeammateOverflow(api, 'claude');
        await recordTeammateCompaction(api, 'claude');
        expect(api.reportTeammateContextEvent).not.toHaveBeenCalled();
        expect((await readThreadsState(home)).thread).not.toHaveProperty('overflowed');
    });

    it('writes only the latest usage once the debounce elapses', async () => {
        const { entry } = await controller();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        recordTeammateContextUsage({ contextTokens: 12 });
        recordTeammateContextUsage({ contextTokens: 24, contextWindow: 200_000 });
        vi.advanceTimersByTime(1999);
        expect(await entry()).not.toHaveProperty('contextTokens');
        vi.advanceTimersByTime(1);
        await vi.waitFor(async () => expect(await entry()).toMatchObject({ contextTokens: 24, contextWindow: 200_000 }));
    });

    it('increments compactions and reports each one', async () => {
        const { entry } = await controller();
        const api = { reportTeammateContextEvent: vi.fn().mockResolvedValue(undefined) };
        await recordTeammateCompaction(api, 'claude');
        await recordTeammateCompaction(api, 'claude');
        expect((await entry()).compactions).toBe(2);
        expect(api.reportTeammateContextEvent).toHaveBeenLastCalledWith('run', {
            code: 'context_compacted', dispatchToken: 'token', provider: 'claude', compactions: 2,
        });
    });

    it('marks the thread overflowed before reporting, and reports only once', async () => {
        const { entry } = await controller();
        const overflowedWhenReported: unknown[] = [];
        const api = { reportTeammateContextEvent: vi.fn(async () => { overflowedWhenReported.push((await entry()).overflowed); }) };
        await recordTeammateOverflow(api, 'codex');
        await recordTeammateOverflow(api, 'codex');
        expect(overflowedWhenReported).toEqual([true]);
        expect(api.reportTeammateContextEvent).toHaveBeenCalledWith('run', {
            code: 'context_lost', dispatchToken: 'token', provider: 'codex', reason: 'overflow',
        });
    });

    it('never throws when reporting fails', async () => {
        await controller();
        const api = { reportTeammateContextEvent: vi.fn().mockRejectedValue(new Error('offline')) };
        await expect(recordTeammateOverflow(api, 'claude')).resolves.toBeUndefined();
    });
});

describe('Claude context overflow detection', () => {
    it('detects the terminal reason on any result subtype', () => {
        expect(isClaudeContextOverflow({ subtype: 'success', terminal_reason: 'prompt_too_long' })).toBe(true);
        expect(isClaudeContextOverflow({ subtype: 'error_during_execution', terminal_reason: 'prompt_too_long' })).toBe(true);
    });

    it.each([
        'Conversation too long. Press esc twice to go up a few messages and try again.',
        'Error: Compaction failed · conversation could not be reduced below the context limit',
        'Prompt is too long, and the conversation cannot be compacted.',
    ])('detects the Claude Code sentence %j', result => {
        expect(isClaudeContextOverflow({ result })).toBe(true);
    });

    it.each([
        'Prompt is too long',
        'The user said the conversation cannot be compacted.',
        `${'x'.repeat(300)} Conversation too long. Press esc twice to go up a few messages and try again.`,
    ])('ignores %j', result => {
        expect(isClaudeContextOverflow({ result })).toBe(false);
    });
});
