import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEAMMATE_RPC_TASK_STOP, TEAMMATE_RPC_RUN_CANCEL, TEAMMATE_RPC_RUN_DISPATCH, TEAMMATE_RPC_LIST_SKILLS } from 'happy-wire';
import { ApiMachineClient, registerTeammateDraftAndSkillsHandlers } from './apiMachine';
import { makeTeammate } from '@/teammate/testFixtures';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/configuration', () => ({ configuration: { happyHomeDir: '/unused-test-home', serverUrl: 'https://api.example.test' } }));
vi.mock('@/teammate/skills', () => ({ listMachineSkills: vi.fn(() => [{ name: 'review', description: 'Review code', source: 'claude', scope: 'USER', path: '/tmp/review/SKILL.md' }]) }));

describe('teammate machine RPC boundary', () => {
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const handlers = {
        spawnSession: vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session' }),
        stopSession: vi.fn(), requestShutdown: vi.fn(),
        orchestratorDispatch: vi.fn(), orchestratorCancel: vi.fn(),
        teammateTaskStop: vi.fn().mockResolvedValue({ ok: true }),
        teammateNotify: vi.fn().mockResolvedValue({ ok: true }),
        teammateRunDispatch: vi.fn().mockReturnValue({ ok: true }),
        teammateRunCancel: vi.fn().mockResolvedValue({ ok: true }),
    };
    beforeEach(() => {
        vi.clearAllMocks(); registered.clear();
        // Exercise registration without socket, terminal, or cache startup side effects.
        const client = Object.create(ApiMachineClient.prototype) as ApiMachineClient;
        Object.defineProperty(client, 'rpcHandlerManager', { value: {
            registerHandler: (name: string, handler: (params: unknown) => Promise<unknown>) => registered.set(name, handler),
        } });
        for (const cache of ['claudeCache', 'geminiCache', 'codexCache']) {
            Object.defineProperty(client, cache, { value: { invalidate: vi.fn() } });
        }
        client.setRPCHandlers(handlers);
        registerTeammateDraftAndSkillsHandlers({
            registerHandler: ((name: string, handler: (params: unknown) => Promise<unknown>) => { registered.set(name, handler); }) as never,
        });
    });

    it('validates wire payloads before dispatch and cancel handlers', async () => {
        const dispatch = registered.get(TEAMMATE_RPC_RUN_DISPATCH)!;
        const cancel = registered.get(TEAMMATE_RPC_RUN_CANCEL)!;
        await expect(dispatch({})).rejects.toThrow();
        await expect(cancel({ runId: 'run' })).rejects.toThrow();
        expect(handlers.teammateRunDispatch).not.toHaveBeenCalled();
        expect(handlers.teammateRunCancel).not.toHaveBeenCalled();
        const payload = {
            runId: 'run', dispatchToken: 'token', attempt: 1, teammate: makeTeammate(),
            thread: { id: 'thread', kind: 'heartbeat', channelId: null, taskId: null, providerSessionId: null, currentSessionId: null, resetAt: null },
            channel: null, task: null,
            trigger: 'manual', events: [],
        };
        expect(await dispatch(payload)).toEqual({ ok: true });
        expect(handlers.teammateRunDispatch).toHaveBeenCalledWith(payload);
        expect(await cancel({ runId: 'run', dispatchToken: 'token' })).toEqual({ ok: true });
        expect(handlers.teammateRunCancel).toHaveBeenCalledWith({ runId: 'run', dispatchToken: 'token' });
    });

    it('validates and forwards task-stop RPC', async () => {
        const stop = registered.get(TEAMMATE_RPC_TASK_STOP)!;
        await expect(stop({ teammateId: 'agent', taskId: 'task', reason: 'invalid' })).rejects.toThrow();
        expect(handlers.teammateTaskStop).not.toHaveBeenCalled();
        const payload = { teammateId: 'agent', taskId: 'task', reason: 'done' };
        expect(await stop(payload)).toEqual({ ok: true });
        expect(handlers.teammateTaskStop).toHaveBeenCalledWith(payload);
    });

    it('registers the machine skill catalog RPC with a wire-valid response', async () => {
        await expect(registered.get(TEAMMATE_RPC_LIST_SKILLS)!({})).resolves.toEqual({ skills: [{
            name: 'review', description: 'Review code', source: 'claude', scope: 'USER', path: '/tmp/review/SKILL.md',
        }] });
    });
    it('never accepts internal extraEnv from spawn-happy-session RPC', async () => {
        await registered.get('spawn-happy-session')!({ directory: '/test', extraEnv: { HAPPY_TEAMMATE_ID: 'injected' } });
        expect(handlers.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ directory: '/test' }));
        expect(handlers.spawnSession.mock.calls[0][0]).not.toHaveProperty('extraEnv');
    });
});
