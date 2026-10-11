import { afterEach, describe, expect, it, vi } from 'vitest';
import { callDaemonTeammateChat } from './controlClient';
import { readDaemonState } from '@/persistence';

vi.mock('@/persistence', () => ({ readDaemonState: vi.fn(), clearDaemonState: vi.fn() }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

const fetchMock = vi.fn();
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset(); });

describe('daemon teammate client', () => {
    it('takes authentication exclusively from environment and uses local daemon discovery', async () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'real-thread');
        vi.stubEnv('HAPPY_TEAMMATE_CONTROL_TOKEN', 'real-token');
        vi.mocked(readDaemonState).mockResolvedValue({ pid: process.pid, httpPort: 4242 } as Awaited<ReturnType<typeof readDaemonState>>);
        vi.stubGlobal('fetch', fetchMock.mockResolvedValue({ ok: true, json: async () => ({ seq: 1 }) }));
        expect(await callDaemonTeammateChat('chat-send', { text: 'hi', threadId: 'forged', controlToken: 'forged' })).toEqual({ seq: 1 });
        expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4242/teammate/chat-send');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'hi', kind: 'text', threadId: 'real-thread', controlToken: 'real-token' });
    });
    it.each([
        ['work-session-start', { repo: 'owner/repo', prompt: 'Implement' }],
        ['work-session-send', { sessionId: 'worker', text: 'Continue' }],
        ['work-session-read', { sessionId: 'worker', limit: 200 }],
        ['work-session-list', {}], ['work-session-stop', { sessionId: 'worker' }],
        ['task-update', { status: 'in_review' }], ['task-comment', { body: 'Claiming' }], ['memory-note', { text: 'Learned' }],
    ] as const)('authenticates and forwards %s to its control route', async (path, body) => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread'); vi.stubEnv('HAPPY_TEAMMATE_CONTROL_TOKEN', 'secret');
        vi.mocked(readDaemonState).mockResolvedValue({ pid: process.pid, httpPort: 4242 } as Awaited<ReturnType<typeof readDaemonState>>);
        vi.stubGlobal('fetch', fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
        expect(await callDaemonTeammateChat(path, body)).toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][0]).toBe(`http://127.0.0.1:4242/teammate/${path}`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ ...body, threadId: 'thread', controlToken: 'secret' });
    });
    it.each([['work-session-start', { repo: 'owner/repo', prompt: 'Implement' }, 15 * 60_000], ['work-session-list', {}, 2 * 60_000]] as const)('gives %s a timeout longer than the 10s default', async (path, body, timeoutMs) => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread'); vi.stubEnv('HAPPY_TEAMMATE_CONTROL_TOKEN', 'secret');
        vi.mocked(readDaemonState).mockResolvedValue({ pid: process.pid, httpPort: 4242 } as Awaited<ReturnType<typeof readDaemonState>>);
        vi.stubGlobal('fetch', fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        await callDaemonTeammateChat(path, body);
        expect(timeout).toHaveBeenCalledWith(timeoutMs);
    });
    it('rejects missing environment and propagates the daemon error', async () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', '');
        await expect(callDaemonTeammateChat('chat-history', {})).rejects.toThrow('Missing teammate');
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread'); vi.stubEnv('HAPPY_TEAMMATE_CONTROL_TOKEN', 'token');
        vi.mocked(readDaemonState).mockResolvedValue({ pid: process.pid, httpPort: 4242 } as Awaited<ReturnType<typeof readDaemonState>>);
        vi.stubGlobal('fetch', fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'Invalid teammate control token' }) }));
        await expect(callDaemonTeammateChat('chat-history', {})).rejects.toThrow('Invalid teammate control token');
    });
});
