import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDaemonControlServer } from './controlServer';
import { TeammateToolSchemas, type TeammateToolPath } from '@/teammate/toolSchemas';
import { createTeammateRuntime, type TeammateRuntimeDependencies } from '@/teammate/runtime';
import { readThreadsState, writeThreadsState } from '@/teammate/homeDir';
import { channelTestKey, machineTestKey, makeChannelMessage, makeConversationPayload } from '@/teammate/testFixtures';
import { decryptChannelMessage } from '@/teammate/channelCrypto';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

describe('teammate local control API', () => {
    let dir: string;
    let home: string;
    let server: Awaited<ReturnType<typeof startDaemonControlServer>>;
    let deps: TeammateRuntimeDependencies;
    const push = vi.fn();
    const auth = { threadId: 'thread-chat', controlToken: 'private-token' };
    async function seed(kind: 'dm' | 'group' = 'dm') {
        const payload = makeConversationPayload(kind);
        await writeThreadsState(home, { [auth.threadId]: {
            controlToken: auth.controlToken, channel: payload.channel, teammateName: 'Atlas',
            lastRunId: payload.runId, lastDispatchToken: payload.dispatchToken,
        } });
    }
    async function post(path: string, body: unknown) {
        const response = await fetch(`http://127.0.0.1:${server.port}/teammate/${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'happy-chat-control-'));
        home = join(dir, 'teammate-atlas'); push.mockReset();
        deps = {
            agentsDir: dir, machineId: 'machine-1', machineKey: machineTestKey,
            spawnSession: vi.fn(), stopSession: vi.fn(), isPidAlive: vi.fn(),
            api: {
                getGithubToken: vi.fn(), registerTeammateSession: vi.fn(), getSessionMessages: vi.fn(), updateTeammateTask: vi.fn(), commentTeammateTask: vi.fn(), createTeammateTask: vi.fn(),
                getChannelMessages: vi.fn().mockResolvedValue([makeChannelMessage()]),
                sendTeammateChannelMessage: vi.fn().mockResolvedValue(makeChannelMessage(13)),
                sendSessionMessage: vi.fn(), reportTeammateRunStarted: vi.fn(), reportTeammateRunFinished: vi.fn(), getTeammateActiveSessions: vi.fn(),
                push: vi.fn().mockReturnValue({ sendToAllDevices: push }),
            },
        };
        await seed();
        // Fresh runtime has no dispatch in memory: exercises persisted restart recovery.
        server = await startDaemonControlServer({
            getChildren: () => [], stopSession: () => true, spawnSession: vi.fn(), requestShutdown: vi.fn(), onHappySessionWebhook: vi.fn(),
            teammateChat: createTeammateRuntime(deps),
        });
    });
    afterEach(async () => { await server.stop(); await rm(dir, { recursive: true, force: true }); });

    it.each(['chat-send', 'chat-history'])('rejects token mismatch and unknown threads for %s', async path => {
        const extra = path === 'chat-send' ? { text: 'secret' } : {};
        expect(await post(path, { ...auth, ...extra, controlToken: 'wrong' })).toMatchObject({ status: 403, body: { message: 'Invalid teammate control token' } });
        expect(await post(path, { ...auth, ...extra, threadId: '../unknown' })).toMatchObject({ status: 404, body: { message: 'Unknown teammate thread' } });
        expect(deps.api.sendTeammateChannelMessage).not.toHaveBeenCalled();
    });
    it('rejects a valid thread with no channel and attempts to send across channels', async () => {
        expect(await post('chat-send', { ...auth, text: 'hi', channelId: 'other' })).toMatchObject({ status: 403 });
        await writeThreadsState(home, { [auth.threadId]: { controlToken: auth.controlToken } });
        expect(await post('chat-history', auth)).toMatchObject({ status: 409, body: { message: 'Teammate thread has no channel' } });
    });
    it('encrypts sends, resolves explicit and inline @handles and persists unique counters', async () => {
        const body = { ...auth, text: 'Please ask @nova', mentions: ['@atlas', 'unknown'], kind: 'decision', options: [{ id: 'go', label: '继续' }] };
        expect(await post('chat-send', body)).toEqual({ status: 200, body: { seq: 13 } });
        const request = vi.mocked(deps.api.sendTeammateChannelMessage).mock.calls[0][0];
        expect(request).toMatchObject({ runId: 'run-chat', dispatchToken: 'dispatch-chat', localId: 'tm:run-chat:1', kind: 'decision', mentions: ['teammate-atlas', 'teammate-nova'] });
        expect(decryptChannelMessage(request.content.c, channelTestKey)).toEqual({ text: body.text, options: body.options });
        await post('chat-send', { ...auth, text: 'again' });
        expect(vi.mocked(deps.api.sendTeammateChannelMessage).mock.calls[1][0].localId).toBe('tm:run-chat:2');
        expect((await readThreadsState(home))[auth.threadId].chatSendCounter).toBe(2);
        const restarted = createTeammateRuntime(deps);
        await restarted.chatSend({ ...auth, text: 'after restart', kind: 'text' });
        expect(vi.mocked(deps.api.sendTeammateChannelMessage).mock.calls[2][0].localId).toBe('tm:run-chat:3');
    });
    it.each([
        ['dm', 'text', true, ''], ['group', 'decision', true, '需要你决定：'],
        ['group', 'report', true, '汇报：'], ['group', 'text', false, ''],
    ] as const)('pushes for %s %s: %s', async (channelKind, kind, expected, prefix) => {
        await seed(channelKind);
        await post('chat-send', { ...auth, text: 'a'.repeat(150), kind });
        expect(push).toHaveBeenCalledTimes(expected ? 1 : 0);
        if (expected) {
            expect(push).toHaveBeenCalledWith(channelKind === 'dm' ? 'Atlas' : 'Atlas · Engineering', expect.stringMatching(new RegExp(`^${prefix}`)), { type: 'teammate-channel', channelId: 'channel-1' });
            expect(Array.from(push.mock.calls[0][1])).toHaveLength(120);
        }
    });
    it('returns decrypted history and preserves system events', async () => {
        vi.mocked(deps.api.getChannelMessages).mockResolvedValue([makeChannelMessage(), { ...makeChannelMessage(13), content: { t: 'system', code: 'context_reset', data: {} } }]);
        expect(await post('chat-history', { ...auth, limit: 20, beforeSeq: 14 })).toMatchObject({ status: 200, body: { messages: [
            { seq: 12, content: { text: '@atlas Review this' } }, { seq: 13, content: { t: 'system', code: 'context_reset' } },
        ] } });
        expect(deps.api.getChannelMessages).toHaveBeenCalledWith('channel-1', { limit: 20, beforeSeq: 14 });
    });
    it('validates tool payloads before invoking chat', async () => {
        expect(await post('chat-history', { ...auth, limit: 201 })).toMatchObject({ status: 400 });
        expect(await post('chat-send', { ...auth, text: 'x', kind: 'unknown' })).toMatchObject({ status: 400 });
    });
});


describe('task tool control routes', () => {
    let server: Awaited<ReturnType<typeof startDaemonControlServer>>;
    const executeTool = vi.fn().mockResolvedValue({ accepted: true });
    beforeEach(async () => {
        executeTool.mockClear();
        server = await startDaemonControlServer({ getChildren: () => [], stopSession: () => true, spawnSession: vi.fn(), requestShutdown: vi.fn(), onHappySessionWebhook: vi.fn(),
            teammateChat: { chatSend: vi.fn(), chatHistory: vi.fn(), executeTool } });
    });
    afterEach(async () => { await server.stop(); });
    async function post(path: string, body: unknown) {
        const response = await fetch(`http://127.0.0.1:${server.port}/teammate/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }
    it('registers all routes with authenticated, validated tool bodies', async () => {
        const inputs: Record<TeammateToolPath, object> = {
            'work-session-start': { repo: 'owner/repo', prompt: 'Implement' }, 'work-session-send': { sessionId: 'worker', text: 'Follow up' },
            'work-session-read': { sessionId: 'worker' }, 'work-session-list': {}, 'work-session-stop': { sessionId: 'worker' },
            'task-update': { summary: 'Ready' }, 'task-comment': { body: 'Claiming' }, 'memory-note': { text: 'Learning' },
            'task-create': { repo: 'owner/repo', title: 'New issue' }, 'memory-commit': { message: 'Update memory' },
        };
        for (const path of Object.keys(TeammateToolSchemas) as TeammateToolPath[]) {
            const auth = { threadId: 'thread', controlToken: 'secret' };
            expect(await post(path, { ...auth, ...inputs[path] })).toEqual({ status: 200, body: { accepted: true } });
            expect(executeTool).toHaveBeenLastCalledWith(path, { ...auth, ...TeammateToolSchemas[path].parse(inputs[path]) });
            expect(await post(path, inputs[path])).toMatchObject({ status: 400 });
        }
        expect(await post('work-session-read', { threadId: 'thread', controlToken: 'secret', sessionId: 'worker', limit: 201 })).toMatchObject({ status: 400 });
        expect(await post('task-update', { threadId: 'thread', controlToken: 'secret' })).toMatchObject({ status: 400 });
    });
});
