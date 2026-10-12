import { describe, expect, it, vi } from 'vitest';

const { authorize, systemMessage, terminate, state } = vi.hoisted(() => ({
    authorize: vi.fn(), systemMessage: vi.fn(), terminate: vi.fn(),
    state: { status: 'running' as string, attempt: 1, retries: 0 },
}));
vi.mock('@/storage/inTx', () => ({ inTx: (fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock('./teammateRunAuthorize', () => ({ teammateRunAuthorize: authorize }));
vi.mock('@/app/channel/channelSystemMessage', () => ({ channelSystemMessage: systemMessage }));
vi.mock('./teammateRunFinish', () => ({ teammateRunTerminateTx: terminate }));

import { teammateRunContextEvent } from './teammateRunContextEvent';

const run = { teammateId: 'mate', teammate: { name: 'Atlas' }, attempt: 1, thread: { channelId: 'channel' } };

function reset(status = 'running', attempt = 1) {
    state.status = status; state.attempt = attempt; state.retries = 0;
    authorize.mockReset().mockImplementation(async () => ({ ...run, status: state.status, attempt: state.attempt }));
    systemMessage.mockReset();
    terminate.mockReset().mockImplementation(async (_tx: unknown, _id: string, status: string, reason: string, _now: Date, _expected: unknown, options?: { allowCompleted?: boolean }) => {
        if (state.status === 'completed' && !options?.allowCompleted) return null;
        if (state.status !== 'running' && state.status !== 'completed') return { ...run, status: state.status, attempt: state.attempt };
        state.status = status;
        if (reason === 'context_overflow' && state.attempt < 2) state.retries++;
        return { ...run, status, attempt: state.attempt };
    });
}

describe('teammateRunContextEvent', () => {
    it('posts compacted events idempotently by compaction count', async () => {
        reset();
        await teammateRunContextEvent('run', { code: 'context_compacted', dispatchToken: 'token', provider: 'claude', compactions: 2 }, 'account');
        await teammateRunContextEvent('run', { code: 'context_compacted', dispatchToken: 'token', provider: 'claude', compactions: 2 }, 'account');
        expect(systemMessage).toHaveBeenCalledWith('channel', 'context_compacted', { teammateId: 'mate', name: 'Atlas', provider: 'claude', compactions: 2 }, {}, 'system:context_compacted:run:2');
        expect(systemMessage).toHaveBeenCalledTimes(2);
        expect(new Set(systemMessage.mock.calls.map(call => call[4]))).toEqual(new Set(['system:context_compacted:run:2']));
    });

    it('posts rollover without touching the run', async () => {
        reset();
        await teammateRunContextEvent('run', { code: 'context_rolled', dispatchToken: 'token', provider: 'claude', reason: 'tokens', segment: 2 }, 'account');
        expect(state.status).toBe('running');
        expect(terminate).not.toHaveBeenCalled();
        expect(systemMessage).toHaveBeenCalledWith('channel', 'context_rolled', {
            teammateId: 'mate', name: 'Atlas', provider: 'claude', reason: 'tokens', segment: 2,
        }, {}, 'system:context_rolled:run');
    });

    it('posts resume_failed once without touching the run', async () => {
        reset();
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'claude', reason: 'resume_failed' }, 'account');
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'claude', reason: 'resume_failed' }, 'account');
        expect(state.status).toBe('running');
        expect(terminate).not.toHaveBeenCalled();
        expect(systemMessage).toHaveBeenCalledTimes(2);
    });

    it('fails a running run, queues one retry, and posts one context_lost', async () => {
        reset();
        terminate.mockResolvedValue(run);
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'codex', reason: 'overflow' }, 'account');
        expect(terminate).toHaveBeenCalledWith({}, 'run', 'failed', 'context_overflow', expect.any(Date), {}, { allowCompleted: true });
        expect(systemMessage).toHaveBeenCalledWith('channel', 'context_lost', { teammateId: 'mate', name: 'Atlas', provider: 'codex', reason: 'overflow' }, {}, 'system:context_lost:run');
    });

    it('fails a just-completed run with the opt-in and queues a retry', async () => {
        reset('completed');
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'claude', reason: 'overflow' }, 'account');
        expect(state.status).toBe('failed');
        expect(state.retries).toBe(1);
        expect(systemMessage).toHaveBeenCalledTimes(1);
    });

    it('makes a repeated overflow report a no-op', async () => {
        reset();
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'claude', reason: 'overflow' }, 'account');
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'claude', reason: 'overflow' }, 'account');
        expect(state.retries).toBe(1);
        expect(systemMessage).toHaveBeenCalledTimes(1);
    });

    it('posts run_failed without retry on the last allowed attempt', async () => {
        reset('running', 2);
        await teammateRunContextEvent('run', { code: 'context_lost', dispatchToken: 'token', provider: 'claude', reason: 'overflow' }, 'account');
        expect(state.status).toBe('failed');
        expect(state.retries).toBe(0);
        expect(systemMessage).not.toHaveBeenCalledWith('channel', 'context_lost', expect.anything(), expect.anything(), expect.anything());
    });

    it('does not fail a completed run without allowCompleted', async () => {
        reset('completed');
        await expect(terminate({}, 'run', 'failed', 'context_overflow', new Date(), {})).resolves.toBeNull();
        expect(state.status).toBe('completed');
    });
});
