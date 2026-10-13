import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEAMMATE_ENV, type ChannelMessage, type TeammateRunDispatchPayload } from 'happy-wire';
import { teammateModelSelection, createTeammateRuntime, contextRolloverLimit, renderRunEventMessage, type TeammateRuntimeDependencies } from './runtime';
import { ensureTeammateHome, mergeThreadState, readThreadsState, writeSessionKeyFile, writeThreadSummary, writeThreadsState } from './homeDir';
import { makeTeammate, makeConversationPayload, makeChannelMessage, channelTestKey } from './testFixtures';
import { encodeBase64, encryptWithDataKey } from '@/api/encryption';
import { getProjectPath } from '@/claude/utils/path';
import { createChannelCrypto } from './channelCrypto';
import { dailyLogDate } from './dailyLogDate';

describe('context rollover limit', () => {
    const at = 1_000_000;
    it('uses cache temperature and model capacity', () => {
        expect(contextRolloverLimit({ contextTokens: 70_000, contextAt: at }, 'claude', at)).toMatchObject({ limit: 120_000, cold: false, roll: false });
        expect(contextRolloverLimit({ contextTokens: 70_000, contextAt: at - 6 * 60_000 }, 'claude', at)).toMatchObject({ limit: 60_000, cold: true, roll: true });
        expect(contextRolloverLimit({ contextWindow: 1_000_000, contextAt: at }, 'claude', at).limit).toBe(600_000);
        expect(contextRolloverLimit({ contextWindow: 258_000, contextAt: at }, 'codex', at).limit).toBe(154_800);
    });

    it('applies teammate budget, growth guard, and dispatch fallback', () => {
        expect(contextRolloverLimit({ contextTokens: 21_000, segmentStartTokens: 20_000, contextAt: at, teammate: makeTeammate({ contextBudgetTokens: 1_500 }) }, 'claude', at)).toMatchObject({ limit: 15_000, grown: false, roll: false });
        expect(contextRolloverLimit({ contextTokens: 30_000, segmentStartTokens: 20_000, contextAt: at, teammate: makeTeammate({ contextBudgetTokens: 1_500 }) }, 'claude', at)).toMatchObject({ grown: true, roll: true });
        expect(contextRolloverLimit({ lastDispatchAt: at, contextTokens: 70_000 }, 'claude', at).cold).toBe(false);
    });

    it('uses the same capacity limit regardless of cache temperature when auto rollover is off', () => {
        const warm = { contextTokens: 180_000, contextAt: at, teammate: makeTeammate({ contextAutoRollover: false, contextBudgetTokens: 10_000 }) };
        expect(contextRolloverLimit(warm, 'claude', at)).toMatchObject({ limit: 180_000, cold: false, auto: false, roll: true });
        expect(contextRolloverLimit({ ...warm, contextAt: at - 6 * 60_000 }, 'claude', at)).toMatchObject({ limit: 180_000, cold: true, roll: true });
        expect(contextRolloverLimit({ contextWindow: 1_000_000 }, 'claude', at, { auto: false }).limit).toBe(980_000);
        expect(contextRolloverLimit({ contextWindow: 32_000 }, 'claude', at, { auto: false }).limit).toBe(25_600);
    });

    it('keeps the growth guard when auto rollover is off', () => {
        const entry = { contextWindow: 32_000, contextTokens: 26_000, segmentStartTokens: 20_000 };
        expect(contextRolloverLimit(entry, 'claude', at, { auto: false })).toMatchObject({ grown: false, roll: false });
        expect(contextRolloverLimit({ ...entry, contextTokens: 33_000 }, 'claude', at, { auto: false })).toMatchObject({ grown: true, roll: true });
    });
});

const skillHooks = vi.hoisted(() => ({ list: vi.fn(() => []), sync: vi.fn(async () => ({ linked: [], missing: [] })) }));
vi.mock('./skills', () => ({ listMachineSkills: skillHooks.list, syncTeammateSkills: skillHooks.sync }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock('@/configuration', () => ({ configuration: { happyHomeDir: '/unused-test-home' } }));

function payload(runId = 'run-1'): TeammateRunDispatchPayload {
    return {
        runId, dispatchToken: `token-${runId}`, attempt: 1, teammate: makeTeammate(),
        thread: { id: 'thread-1', kind: 'heartbeat', channelId: null, taskId: null, providerSessionId: null, currentSessionId: null, resetAt: null },
        channel: null, task: null,
        trigger: 'manual', events: [{ type: 'manual', at: Date.UTC(2026, 9, 8, 12), data: { note: 'Review the repository' } }],
    };
}

describe('teammate runtime', () => {
    let dir: string;
    let home: string;
    let deps: TeammateRuntimeDependencies;
    let runtime: ReturnType<typeof createTeammateRuntime>;
    const clock = Date.UTC(2026, 9, 9);

    it('overflowed entry spawn notice includes up to 30 earlier messages', async () => {
        const payload = makeConversationPayload();
        payload.events[0] = { ...payload.events[0], data: { ...payload.events[0].data, seq: 36 } } as typeof payload.events[0];
        const messages = Array.from({ length: 35 }, (_, index) => makeChannelMessage(index + 1, `earlier ${index + 1}`));
        const api = { getChannelMessages: vi.fn().mockResolvedValueOnce(messages).mockResolvedValue([makeChannelMessage(36, 'new')]) };
        const rendered = await renderRunEventMessage(payload, { api, crypto: createChannelCrypto(new Uint8Array(32).fill(17)) }, undefined, undefined, 'overflow');
        expect(rendered).toContain('Session continuity');
        expect(rendered).toContain('earlier 35');
        expect(rendered).not.toContain('earlier 5');
        expect(api.getChannelMessages).toHaveBeenNthCalledWith(1, 'channel-1', { beforeSeq: 36, limit: 30 });
    });

    it('without continuity renders at most ten earlier messages', async () => {
        const payload = makeConversationPayload();
        const messages = Array.from({ length: 11 }, (_, index) => makeChannelMessage(index + 1, `earlier ${index + 1}`));
        const api = { getChannelMessages: vi.fn().mockResolvedValueOnce(messages).mockResolvedValue([makeChannelMessage(12, 'new')]) };
        const rendered = await renderRunEventMessage(payload, { api, crypto: createChannelCrypto(new Uint8Array(32).fill(17)) });
        expect(rendered).not.toContain('(seq 1,');
        expect(rendered).toContain('earlier 2');
        expect(api.getChannelMessages).toHaveBeenNthCalledWith(1, 'channel-1', { beforeSeq: 12, limit: 10 });
    });


    beforeEach(async () => {
        skillHooks.list.mockClear();
        skillHooks.sync.mockClear();
        dir = await mkdtemp(join(tmpdir(), 'happy-teammate-runtime-'));
        home = join(dir, 'teammate-atlas');
        deps = {
            machineKey: new Uint8Array(32).fill(17), agentsDir: dir, machineId: 'machine-1', now: () => clock, idleTtlMs: 30 * 60_000,
            api: {
                getGithubToken: vi.fn(), registerTeammateSession: vi.fn(), getSessionMessages: vi.fn(), updateTeammateTask: vi.fn(), commentTeammateTask: vi.fn(), createTeammateTask: vi.fn(),
                getChannelMessages: vi.fn().mockResolvedValue([]),
                sendTeammateChannelMessage: vi.fn(),
                push: vi.fn(),
                sendSessionMessage: vi.fn().mockResolvedValue('sent'),
                reportTeammateRunStarted: vi.fn().mockResolvedValue(undefined),
                reportTeammateContextEvent: vi.fn().mockResolvedValue(undefined),
                reportTeammateRunFinished: vi.fn().mockResolvedValue(undefined),
                getTeammateActiveSessions: vi.fn().mockResolvedValue({ sessionIds: [] }),
            },
            spawnSession: vi.fn().mockResolvedValue({ type: 'success', sessionId: 'happy-1', pid: 123 }),
            trackSession: vi.fn(),
            stopSession: vi.fn().mockResolvedValue(true), isPidAlive: vi.fn(pid => pid !== 999),
            oneShot: vi.fn().mockResolvedValue('<summary>\n## Goal and background\n## Current instruction\n## Decisions\n## In progress\n## Open commitments\n## Mistakes and corrections\n## References\n## Search hints\n</summary><durable></durable>'),
        };
        runtime = createTeammateRuntime(deps);
    });
    afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

    async function started(count = 1) {
        await vi.waitFor(() => expect(deps.api.reportTeammateRunStarted).toHaveBeenCalledTimes(count), { timeout: 5000 });
    }
    async function seedLive() {
        const keyPath = await writeSessionKeyFile(home, 'existing', new Uint8Array(32).fill(7));
        await writeThreadsState(home, {
            'thread-1': { controlToken: 'existing-token', pid: 123, currentSessionId: 'happy-existing', keyPath, providerSessionId: 'claude-existing', lastDispatchAt: 1,
                provider: 'claude', controllerConfig: JSON.stringify(['claude', null]) },
        });
        return keyPath;
    }

    function dmPayload(provider: 'claude' | 'codex', controllerEnv: string | null = null) {
        const event = payload();
        event.thread.kind = 'dm';
        event.teammate.controllerProvider = provider;
        event.teammate.controllerEnv = controllerEnv;
        return event;
    }
    function continuityReported(provider: 'claude' | 'codex') {
        return vi.waitFor(() => expect(deps.api.reportTeammateContextEvent).toHaveBeenCalledWith('run-1', {
            code: 'context_lost', reason: 'resume_failed', dispatchToken: 'token-run-1', provider,
        }));
    }
    function sentMessage() {
        return vi.mocked(deps.api.sendSessionMessage).mock.calls[0][1];
    }

    it('starts an overflowed thread fresh with a notice and clears its context state', async () => {
        await seedLive();
        await mergeThreadState(home, 'thread-1', { overflowed: true, compactions: 2, contextTokens: 190_000, contextWindow: 200_000 });
        const event = dmPayload('claude');
        runtime.dispatch(event); await started();
        expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
        expect(sentMessage()).toContain('it ran out of context window');
        expect(deps.api.reportTeammateContextEvent).not.toHaveBeenCalled();
        const state = (await readThreadsState(home))['thread-1'];
        expect(state).not.toHaveProperty('overflowed');
        expect(state).not.toHaveProperty('compactions');
        expect(state).not.toHaveProperty('contextTokens');
        expect(state).not.toHaveProperty('contextWindow');
    });

    it('starts fresh with a notice and reports once when the Codex rollout is gone', async () => {
        vi.stubEnv('CODEX_HOME', join(dir, 'owner-codex'));
        await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'codex', providerSessionId: 'codex-gone' } });
        runtime.dispatch(dmPayload('codex')); await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', resumeSessionId: undefined }));
        expect(sentMessage()).toContain('it could not be restored');
        await continuityReported('codex');
        expect(deps.api.reportTeammateContextEvent).toHaveBeenCalledTimes(1);
        expect(deps.api.reportTeammateRunStarted).toHaveBeenCalledWith('run-1', expect.objectContaining({ resumed: false }));
    });

    it('checks the Claude transcript in the profile CLAUDE_CONFIG_DIR before resuming', async () => {
        const configDir = join(dir, 'claude-config');
        const env = encodeBase64(encryptWithDataKey({ environmentVariables: { CLAUDE_CONFIG_DIR: configDir }, inheritMachineConfig: false }, deps.machineKey!));
        await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'claude', providerSessionId: 'claude-gone' } });
        runtime.dispatch(dmPayload('claude', env)); await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
        expect(sentMessage()).toContain('Session continuity');
        await continuityReported('claude');
        expect(deps.api.reportTeammateContextEvent).toHaveBeenCalledTimes(1);
    });

    it('resumes a valid Claude transcript without a notice or event', async () => {
        const configDir = join(dir, 'claude-config');
        const env = encodeBase64(encryptWithDataKey({ environmentVariables: { CLAUDE_CONFIG_DIR: configDir }, inheritMachineConfig: false }, deps.machineKey!));
        await ensureTeammateHome(makeTeammate(), { dir: home });
        const projectDir = getProjectPath(home, configDir);
        await mkdir(projectDir, { recursive: true });
        await writeFile(join(projectDir, 'claude-ok.jsonl'), `${JSON.stringify({ uuid: 'message-1' })}\n`);
        await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'claude', providerSessionId: 'claude-ok' } });
        runtime.dispatch(dmPayload('claude', env)); await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'claude-ok' }));
        expect(sentMessage()).not.toContain('Session continuity');
        expect(sentMessage()).not.toContain('Memory update:');
        expect(deps.api.reportTeammateContextEvent).not.toHaveBeenCalled();
        expect(deps.api.reportTeammateRunStarted).toHaveBeenCalledWith('run-1', expect.objectContaining({ resumed: true }));
    });

    it('attaches memory updates when a Codex controller resumes', async () => {
        const codexHome = join(dir, 'codex-home');
        vi.stubEnv('CODEX_HOME', codexHome);
        await mkdir(join(codexHome, 'sessions', '2026', '01', '01'), { recursive: true });
        await writeFile(join(codexHome, 'sessions', '2026', '01', '01', 'rollout-2026-01-01-codex-old.jsonl'), '{}\n');
        await ensureTeammateHome(makeTeammate(), { dir: home });
        await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'codex', providerSessionId: 'codex-old', memorySeenAt: 0 } });
        const event = dmPayload('codex');
        runtime.dispatch(event); await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex' }));
        expect(sentMessage()).toContain('Memory update:');
    });

    it('clears context usage state on a thread reset', async () => {
        await seedLive();
        await mergeThreadState(home, 'thread-1', { compactions: 3, contextTokens: 120_000, contextWindow: 200_000 });
        const event = payload(); event.thread.resetAt = clock;
        runtime.dispatch(event); await started();
        const state = (await readThreadsState(home))['thread-1'];
        expect(state.resetAppliedAt).toBe(clock);
        expect(state).not.toHaveProperty('compactions');
        expect(state).not.toHaveProperty('contextTokens');
        expect(state).not.toHaveProperty('contextWindow');
    });

    describe('context rollover', () => {
        const summaryOutput = '<summary>\n## Decisions\n- Alex chose PR #42\n</summary>\n<durable>\n- Alex prefers small PRs\n</durable>';
        const promptFile = () => readFile(join(home, 'state', 'prompts', 'thread-1.md'), 'utf8');
        beforeEach(() => {
            vi.mocked(deps.api.getSessionMessages).mockResolvedValue({ messages: [] });
            vi.mocked(deps.oneShot!).mockResolvedValue(summaryOutput);
        });
        async function expectRolled(reason: 'tokens' | 'compacted') {
            expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
            expect(sentMessage()).toContain('condensed into a new segment');
            await vi.waitFor(() => expect(deps.api.reportTeammateContextEvent).toHaveBeenCalledWith('run-1', {
                code: 'context_rolled', reason, segment: 2, dispatchToken: 'token-run-1', provider: 'claude',
            }));
            const state = (await readThreadsState(home))['thread-1'];
            expect(state.segment).toBe(2);
            expect(state.flushedSegment).toBe(1);
            for (const key of ['compactions', 'contextTokens', 'contextWindow', 'contextAt', 'cachedTokens', 'segmentStartTokens', 'overflowed']) expect(state).not.toHaveProperty(key);
            expect(await promptFile()).toContain('## Thread summary');
            expect(await promptFile()).toContain('Alex chose PR #42');
        }

        it('rolls a live thread over after a compaction with a final summary', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { compactions: 1, contextTokens: 40_000 });
            runtime.dispatch(dmPayload('claude')); await started();
            expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
            expect(deps.oneShot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('final: true'), timeoutMs: 60_000 }));
            await expectRolled('compacted');
            const log = await readFile(join(home, 'memory', `${dailyLogDate(new Date(clock))}.md`), 'utf8');
            expect(log).toContain('[thread thread-1 seg 1');
            expect(log).toContain('Alex prefers small PRs');
        });

        it('rolls a live thread over at the window ratio', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { contextTokens: 120_000, contextWindow: 200_000 });
            runtime.dispatch(dmPayload('claude')); await started();
            expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
            await expectRolled('tokens');
        });

        it('keeps a warm 70k thread and rolls it after its cache expires', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { contextTokens: 70_000, contextAt: clock, cachedTokens: 65_000, segmentStartTokens: 10_000 });
            runtime.dispatch(dmPayload('claude')); await started();
            expect(deps.oneShot).not.toHaveBeenCalled();
            await mergeThreadState(home, 'thread-1', { contextAt: clock - 6 * 60_000 });
            const event = dmPayload('claude'); event.runId = 'run-2'; event.dispatchToken = 'token-run-2';
            runtime.dispatch(event); await started(2);
            expect((await readThreadsState(home))['thread-1']).not.toHaveProperty('segmentStartTokens');
            expect((await readThreadsState(home))['thread-1']).not.toHaveProperty('contextAt');
            expect((await readThreadsState(home))['thread-1']).not.toHaveProperty('cachedTokens');
        });

        it('rolls a reaped thread over at the idle threshold instead of resuming', async () => {
            await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'claude', providerSessionId: 'claude-old', contextTokens: 60_000 } });
            runtime.dispatch(dmPayload('claude')); await started();
            await expectRolled('tokens');
            expect((await readThreadsState(home))['thread-1'].providerSessionId).toBeUndefined();
        });

        it('keeps a live thread below the thresholds without a summary', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { contextTokens: 119_000, contextWindow: 200_000, contextAt: clock });
            runtime.dispatch(dmPayload('claude')); await started();
            expect(deps.spawnSession).not.toHaveBeenCalled();
            expect(deps.oneShot).not.toHaveBeenCalled();
            expect(sentMessage()).not.toContain('Session continuity');
            expect(deps.api.reportTeammateContextEvent).not.toHaveBeenCalled();
        });

        it('never rolls heartbeat threads over', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { compactions: 1, contextTokens: 190_000, contextWindow: 200_000 });
            runtime.dispatch(payload()); await started();
            expect(deps.oneShot).not.toHaveBeenCalled();
            expect(deps.api.reportTeammateContextEvent).not.toHaveBeenCalled();
            expect((await readThreadsState(home))['thread-1']).not.toHaveProperty('segment');
        });

        it('reuses a summary the reap already finished', async () => {
            await seedLive();
            await writeThreadSummary(home, 'thread-1', 'Reaped summary', { threadId: 'thread-1', kind: 'dm', segment: 1, coversSeq: 0 });
            await mergeThreadState(home, 'thread-1', { compactions: 1, summarizedSeq: 0, summarizedSession: { id: 'happy-existing', seq: 5 }, flushedSegment: 1 });
            runtime.dispatch(dmPayload('claude')); await started();
            expect(deps.oneShot).not.toHaveBeenCalled();
            expect(await promptFile()).toContain('Reaped summary');
        });

        it('still starts the new segment when the summary fails', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { compactions: 1 });
            vi.mocked(deps.oneShot!).mockRejectedValue(new Error('timeout'));
            runtime.dispatch(dmPayload('claude')); await started();
            expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
            expect((await readThreadsState(home))['thread-1'].segment).toBe(2);
            expect(await promptFile()).not.toContain('## Thread summary');
        });

        it('archives the old topic on /new and points the new prompt at search', async () => {
            await seedLive();
            await writeThreadSummary(home, 'thread-1', 'Old topic', { threadId: 'thread-1', kind: 'dm', segment: 1, coversSeq: 0 });
            const event = dmPayload('claude'); event.thread.resetAt = clock;
            runtime.dispatch(event); await started();
            expect(await readFile(join(home, 'state', 'threads', 'thread-1', 'archive', '1.md'), 'utf8')).toContain('Alex chose PR #42');
            await expect(stat(join(home, 'state', 'threads', 'thread-1', 'summary.md'))).rejects.toThrow();
            expect(await promptFile()).toContain('Earlier topics in this thread are archived');
            expect(sentMessage()).not.toContain('Session continuity');
            expect(deps.api.reportTeammateContextEvent).not.toHaveBeenCalled();
            expect((await readThreadsState(home))['thread-1']).toMatchObject({ segment: 2, resetAppliedAt: clock });
        });

        it('reads the idle threshold from the environment', async () => {
            vi.stubEnv('HAPPY_TEAMMATE_ROLLOVER_IDLE_TOKENS', '1000');
            vi.resetModules();
            const { createTeammateRuntime: create } = await import('./runtime');
            await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'claude', providerSessionId: 'claude-old', contextTokens: 1000 } });
            create(deps).dispatch(dmPayload('claude')); await started();
            await expectRolled('tokens');
        });

        it('attaches a changed memory file once for a live controller', async () => {
            await ensureTeammateHome(makeTeammate(), { dir: home });
            runtime = createTeammateRuntime({ ...deps, now: Date.now });
            await seedLive();
            await mergeThreadState(home, 'thread-1', { memorySeenAt: 0 });
            const event = dmPayload('claude');
            runtime.dispatch(event); await started();
            expect(sentMessage()).toContain('Memory update: these files changed since your session started.');
            expect(sentMessage()).toContain('## MEMORY.md');
            vi.mocked(deps.api.sendSessionMessage).mockClear();
            const second = { ...event, runId: 'run-2', dispatchToken: 'token-run-2' };
            runtime.dispatch(second); await started(2);
            expect(vi.mocked(deps.api.sendSessionMessage).mock.calls[0][1]).not.toContain('Memory update:');
        });

        it('refreshes USER.md but never MEMORY.md in a group', async () => {
            await ensureTeammateHome(makeTeammate(), { dir: home });
            runtime = createTeammateRuntime({ ...deps, now: Date.now });
            await seedLive();
            await mergeThreadState(home, 'thread-1', { memorySeenAt: 0 });
            const event = makeConversationPayload('group'); event.thread.id = 'thread-1'; event.runId = 'run-1'; event.dispatchToken = 'token-run-1';
            event.teammate.controllerProvider = 'claude'; event.teammate.controllerEnv = null;
            event.events = [{ type: 'manual', at: 1, data: { note: 'group memory refresh' } }];
            runtime.dispatch(event); await started();
            expect(sentMessage()).toContain('## USER.md');
            expect(sentMessage()).not.toContain('## MEMORY.md');
        });

        it('tells a live group controller once when the brief changes or is removed', async () => {
            await ensureTeammateHome(makeTeammate(), { dir: home });
            runtime = createTeammateRuntime({ ...deps, now: Date.now });
            await seedLive();
            const groupRun = (runId: string, brief: string | null) => {
                const event = makeConversationPayload('group'); event.thread.id = 'thread-1'; event.runId = runId; event.dispatchToken = `token-${runId}`;
                event.teammate.controllerProvider = 'claude'; event.teammate.controllerEnv = null;
                event.channel!.brief = brief === null ? null : encodeBase64(encryptWithDataKey({ text: brief }, channelTestKey));
                event.events = [{ type: 'manual', at: 1, data: { note: 'brief check' } }];
                return event;
            };
            const sent = (call: number) => vi.mocked(deps.api.sendSessionMessage).mock.calls[call][1];
            const first = groupRun('run-1', 'Builder implements, reviewer reviews.');
            runtime.dispatch(first); await started();
            expect(sent(0)).toContain("Group brief update: the owner changed this group's brief.");
            expect(sent(0)).toContain('Builder implements, reviewer reviews.');
            runtime.dispatch({ ...first, runId: 'run-2', dispatchToken: 'token-run-2' }); await started(2);
            expect(sent(1)).not.toContain('Group brief update');
            runtime.dispatch(groupRun('run-3', null)); await started(3);
            expect(sent(2)).toContain("the owner removed this group's brief");
        });

        it('rolls a task thread and starts a fresh segment with its summary', async () => {
            const event = dmPayload('claude');
            event.thread.kind = 'task'; event.thread.channelId = null; event.thread.taskId = 'task-1'; event.channel = null;
            event.task = { id: 'task-1', teammateId: event.teammate.id, createdByTeammateId: null, source: 'github-issue', resourceId: 'owner/repo#1', title: 'Fix task', url: null, status: 'in_progress', summary: 'Working', prUrl: null, reviewRound: 1, createdAt: 1, updatedAt: 1 };
            await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'claude', providerSessionId: 'old-session', contextTokens: 60_000, threadKind: 'task' } });
            runtime.dispatch(event); await started();
            expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
            expect((await readThreadsState(home))['thread-1'].segment).toBe(2);
            expect(sentMessage()).toContain('condensed into a new segment');
            expect(deps.api.reportTeammateContextEvent).toHaveBeenCalledWith('run-1', expect.objectContaining({ code: 'context_rolled', reason: 'tokens', segment: 2 }));
            expect((await readThreadsState(home))['thread-1'].memorySeenAt).toBe(clock);
            expect(await promptFile()).toContain('Alex chose PR #42');
            expect(deps.api.getChannelMessages).not.toHaveBeenCalled();
        });

        it('rolls a live task thread over after a compaction', async () => {
            await seedLive();
            await mergeThreadState(home, 'thread-1', { compactions: 1, threadKind: 'task' });
            const event = dmPayload('claude');
            event.thread.kind = 'task'; event.thread.channelId = null; event.thread.taskId = 'task-1'; event.channel = null;
            runtime.dispatch(event); await started();
            expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
            expect(deps.oneShot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('<task-state>') }));
            expect((await readThreadsState(home))['thread-1'].segment).toBe(2);
            expect(deps.api.reportTeammateContextEvent).toHaveBeenCalledWith('run-1', expect.objectContaining({ code: 'context_rolled', reason: 'compacted' }));
        });

        it('starts the next segment after the newest channel seq', async () => {
            await writeThreadsState(home, { 'thread-1': { pid: 999, provider: 'claude', providerSessionId: 'claude-old', contextTokens: 60_000 } });
            vi.mocked(deps.api.getChannelMessages).mockResolvedValueOnce([{ seq: 41, createdAt: 1, senderId: 'u', content: { t: 'system', code: 'run_failed', data: {} } }] as any);
            const event = makeConversationPayload('dm'); event.thread.id = 'thread-1'; event.runId = 'run-1'; event.dispatchToken = 'token-run-1';
            event.teammate.controllerProvider = 'claude'; event.teammate.controllerEnv = null;
            event.events = [{ type: 'manual', at: 1, data: { note: 'continue' } }];
            runtime.dispatch(event); await started();
            expect((await readThreadsState(home))['thread-1'].segmentStartSeq).toBe(42);
        });

        describe('idle reap', () => {
            const idle = clock - 31 * 60_000;
            async function seedIdle(threadKind: 'dm' | 'heartbeat' | 'task', contextTokens: number) {
                await writeThreadsState(home, { 'thread-1': { pid: 123, currentSessionId: 'idle', provider: 'claude', lastDispatchAt: idle, threadKind, contextTokens } });
            }

            it('writes a final summary when the next dispatch will roll over', async () => {
                await seedIdle('dm', 60_000);
                await runtime.reapIdle();
                await vi.waitFor(() => expect(deps.oneShot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('final: true') })));
                await vi.waitFor(async () => expect((await readThreadsState(home))['thread-1'].flushedSegment).toBe(1));
            });

            it('uses the capacity limit for final summaries when auto rollover is off', async () => {
                await seedIdle('dm', 180_000);
                await mergeThreadState(home, 'thread-1', { teammate: makeTeammate({ contextAutoRollover: false }) });
                await runtime.reapIdle();
                await vi.waitFor(() => expect(deps.oneShot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('final: true') })));
            });

            it('keeps compactions final when auto rollover is off and capacity is available', async () => {
                await seedIdle('dm', 60_000);
                await mergeThreadState(home, 'thread-1', { teammate: makeTeammate({ contextAutoRollover: false }), compactions: 1 });
                await runtime.reapIdle();
                await vi.waitFor(() => expect(deps.oneShot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('final: true') })));
            });

            it('skips the model below the threshold when nothing is new', async () => {
                await seedIdle('dm', 59_000);
                await runtime.reapIdle();
                expect(deps.stopSession).toHaveBeenCalledWith('idle');
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(deps.oneShot).not.toHaveBeenCalled();
            });

            it('does not summarize heartbeat threads', async () => {
                await seedIdle('heartbeat', 190_000);
                await runtime.reapIdle();
                expect(deps.stopSession).toHaveBeenCalledWith('idle');
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(deps.api.getSessionMessages).not.toHaveBeenCalled();
                expect(deps.oneShot).not.toHaveBeenCalled();
            });

            it('schedules a summary for task threads', async () => {
                await seedIdle('task', 60_000);
                await runtime.reapIdle();
                await vi.waitFor(() => expect(deps.oneShot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('final: true') })));
            });

            it('does not wait for the summary', async () => {
                await seedIdle('dm', 60_000);
                vi.mocked(deps.oneShot!).mockReturnValue(new Promise(() => {}));
                await runtime.reapIdle();
                expect((await readThreadsState(home))['thread-1']).not.toHaveProperty('pid');
            });
        });
    });

    describe('chat_history query', () => {
        type SearchResult = { matches: { seq: number; sender: string; text: string; context: { seq: number }[] }[]; scanned: number; oldestScannedSeq?: number; exhausted: boolean };

        async function seedChannel(messages: ChannelMessage[], resetAt: number | null = null) {
            await seedLive();
            vi.mocked(deps.api.getChannelMessages).mockImplementation(async (_channelId, query = {}) => {
                const inRange = messages.filter(message => (query.afterSeq === undefined || message.seq > query.afterSeq)
                    && (query.beforeSeq === undefined || message.seq < query.beforeSeq));
                const limit = query.limit ?? 50;
                return query.afterSeq === undefined ? inRange.slice(-limit) : inRange.slice(0, limit);
            });
            const event = makeConversationPayload(); event.thread.id = 'thread-1'; event.thread.resetAt = resetAt;
            const [wake] = event.events;
            event.events = [{ ...wake, data: { ...wake.data, seq: messages.at(-1)!.seq } }];
            runtime.dispatch(event); await started();
            vi.mocked(deps.api.getChannelMessages).mockClear();
            const { controlToken } = (await readThreadsState(home))['thread-1'];
            return {
                search: async (query: string, beforeSeq?: number) =>
                    await runtime.chatHistory({ threadId: 'thread-1', controlToken: controlToken!, query, beforeSeq }) as SearchResult,
                read: (limit: number) => runtime.chatHistory({ threadId: 'thread-1', controlToken: controlToken!, limit }),
            };
        }
        const texts = (count: number, text: (seq: number) => string) => Array.from({ length: count }, (_, index) => makeChannelMessage(index + 1, text(index + 1)));

        it('matches all terms case-insensitively, newest first, with neighbours', async () => {
            const { search } = await seedChannel([
                makeChannelMessage(1, 'deploy plan alpha'), makeChannelMessage(2, 'unrelated'),
                makeChannelMessage(3, 'Alpha DEPLOY done'), makeChannelMessage(4, 'alpha only'),
            ]);
            const result = await search('deploy ALPHA');
            expect(result.matches.map(match => match.seq)).toEqual([3, 1]);
            expect(result.matches[0]).toMatchObject({ sender: 'Alex', text: 'Alpha DEPLOY done' });
            expect(result.matches[0].context.map(neighbour => neighbour.seq)).toEqual([2, 4]);
            expect(result.matches[1].context.map(neighbour => neighbour.seq)).toEqual([2]);
            expect(result).toMatchObject({ scanned: 4, oldestScannedSeq: 1, exhausted: true });
        });

        it('searches across a context reset and returns at most twenty matches', async () => {
            const { search } = await seedChannel(texts(30, seq => `needle ${seq}`), Date.UTC(2026, 9, 10));
            const result = await search('needle');
            expect(result.matches).toHaveLength(20);
            expect(result.matches[0].seq).toBe(30);
            expect(result.matches[19].seq).toBe(11);
        });

        it('stops at 2000 scanned messages and pages on from oldestScannedSeq without duplicates', async () => {
            const { search } = await seedChannel(texts(2500, seq => seq === 100 || seq === 2400 ? `needle ${seq}` : `filler ${seq}`));
            const first = await search('needle');
            expect(first).toMatchObject({ scanned: 2000, oldestScannedSeq: 501, exhausted: false });
            expect(first.matches.map(match => match.seq)).toEqual([2400]);
            const next = await search('needle', first.oldestScannedSeq);
            expect(next).toMatchObject({ scanned: 500, oldestScannedSeq: 1, exhausted: true });
            expect(next.matches.map(match => match.seq)).toEqual([100]);
        });

        it('serves repeated searches from the cache', async () => {
            const { search } = await seedChannel(texts(450, seq => `filler ${seq}`));
            await search('filler', 400);
            const fetched = vi.mocked(deps.api.getChannelMessages).mock.calls.length;
            expect(fetched).toBeGreaterThan(0);
            expect(await search('filler', 400)).toMatchObject({ scanned: 399, exhausted: true });
            expect(deps.api.getChannelMessages).toHaveBeenCalledTimes(fetched);
            await search('filler');
            expect(deps.api.getChannelMessages).toHaveBeenCalledTimes(fetched + 1);
        });

        it('keeps the plain history response when no query is given', async () => {
            const { read } = await seedChannel(texts(3, seq => `message ${seq}`));
            const result = await read(2);
            expect(deps.api.getChannelMessages).toHaveBeenCalledWith('channel-1', { limit: 2, beforeSeq: undefined });
            expect(result).toEqual({ messages: [2, 3].map(seq => ({ ...makeChannelMessage(seq, `message ${seq}`), content: { text: `message ${seq}` } })) });
        });
    });

    it('skips only an empty scheduled heartbeat and runs manual or mixed events', async () => {
        const scheduled = payload();
        scheduled.trigger = 'heartbeat';
        scheduled.events = [{ type: 'heartbeat', at: clock, data: { scheduled: true } }];
        expect(await runtime.dispatch(scheduled)).toEqual({ ok: true, skipped: true });
        expect(deps.spawnSession).not.toHaveBeenCalled();
        const mixed = payload('mixed');
        mixed.events = [...scheduled.events, { type: 'heartbeat', at: clock, data: { manual: true } }];
        await runtime.dispatch(mixed); await started();
        expect(deps.spawnSession).toHaveBeenCalledTimes(1);
    });

    it('continues spawning when skill discovery or sync fails', async () => {
        skillHooks.list.mockImplementationOnce(() => { throw new Error('discovery failed'); });
        await runtime.dispatch(payload('skills-fail'));
        await started();
        expect(deps.spawnSession).toHaveBeenCalledTimes(1);
    });

    it('persists task_create request counters and sends validated notifications', async () => {
        await seedLive();
        const event = payload(); event.thread.kind = 'dm';
        await runtime.dispatch(event); await started();
        const token = (await readThreadsState(home))['thread-1'].controlToken!;
        const auth = { threadId: 'thread-1', controlToken: token };
        await runtime.executeTool('task-create', { ...auth, repo: 'owner/repo', title: 'First', reviewer: 'nova' });
        expect(deps.api.createTeammateTask).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: 'First', reviewer: 'nova' }));
        await runtime.executeTool('task-create', { ...auth, repo: 'owner/repo', title: 'Second' });
        expect(deps.api.createTeammateTask).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId: 'tc:run-1:2' }));
        expect((await readThreadsState(home))['thread-1'].taskCreateCounter).toBe(2);
        const sendToAllDevices = vi.fn();
        vi.mocked(deps.api.push).mockReturnValue({ sendToAllDevices } as unknown as ReturnType<typeof deps.api.push>);
        expect(await runtime.notify({ teammateId: 'teammate-atlas', title: 'Budget', body: 'Paused', data: { type: 'bad', runId: 'run-1' } })).toEqual({ ok: true });
        expect(sendToAllDevices).toHaveBeenCalledWith('Budget', 'Paused', { type: 'teammate', teammateId: 'teammate-atlas', runId: 'run-1' });
    });

    it('snapshots dirty home before a dreaming spawn and starts fresh', async () => {
        await ensureTeammateHome(makeTeammate(), { dir: home });
        await writeFile(join(home, 'MEMORY.md'), 'Pending memory');
        await seedLive();
        const event = payload(); event.thread.kind = 'dreaming'; event.trigger = 'dreaming';
        event.events = [{ type: 'dreaming', at: clock, data: { since: clock - 86_400_000 } }];
        await runtime.dispatch(event); await started();
        expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('happy-1', expect.stringContaining('Call memory_commit'), expect.any(Uint8Array), 'teammate-run:run-1', 'default', null, null);
    });

    it('acknowledges immediately, spawns a controller with private key and prompt, then delivers and reports', async () => {
        const event = payload();
        event.thread.taskId = 'task-1';
        expect(await runtime.dispatch(event)).toEqual({ ok: true });
        expect(deps.spawnSession).not.toHaveBeenCalled();
        await started();
        const options = vi.mocked(deps.spawnSession).mock.calls[0][0];
        expect(options).toMatchObject({ directory: home, agent: 'claude', sessionTitle: 'Atlas · heartbeat' });
        const env = options.extraEnv!;
        expect(Object.keys(env).sort()).toEqual([...Object.entries(TEAMMATE_ENV).filter(([key]) => !['workerId', 'externalContext', 'readOnly'].includes(key)).map(([, value]) => value), 'CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT', 'PATH'].sort());
        expect(env).toMatchObject({ CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(20 * 60_000),
            [TEAMMATE_ENV.teammateId]: event.teammate.id, [TEAMMATE_ENV.threadId]: event.thread.id,
            [TEAMMATE_ENV.sessionRole]: 'controller', [TEAMMATE_ENV.home]: home, [TEAMMATE_ENV.taskId]: 'task-1',
        });
        expect((await stat(env[TEAMMATE_ENV.sessionDataKeyFile])).mode & 0o777).toBe(0o600);
        expect(await readFile(env[TEAMMATE_ENV.systemPromptFile], 'utf8')).toContain('## Current thread');
        expect(await readThreadsState(home)).toMatchObject({ 'thread-1': {
            currentSessionId: 'happy-1', pid: 123, keyPath: env[TEAMMATE_ENV.sessionDataKeyFile], lastDispatchAt: clock,
        } });
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('happy-1', await renderRunEventMessage(event),
            new Uint8Array(Buffer.from(await readFile(env[TEAMMATE_ENV.sessionDataKeyFile], 'utf8'), 'base64')), 'teammate-run:run-1', 'default', null, null);
        expect(deps.api.reportTeammateRunStarted).toHaveBeenCalledWith('run-1', {
            dispatchToken: 'token-run-1', sessionId: 'happy-1', resumed: false, delivery: 'sent',
        });
    });

    it('reuses a live session and preserves its provider id', async () => {
        await seedLive();
        vi.mocked(deps.api.sendSessionMessage).mockResolvedValue('queued');
        runtime.dispatch(payload());
        await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
        expect(deps.trackSession).toHaveBeenCalledWith('happy-existing', 123);
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('happy-1', expect.any(String), expect.any(Uint8Array), 'teammate-run:run-1', 'default', null, null);
        expect(deps.api.reportTeammateRunStarted).toHaveBeenCalledWith('run-1', expect.objectContaining({ resumed: false, delivery: 'queued' }));
        expect((await readThreadsState(home))['thread-1']).toMatchObject({ providerSessionId: 'claude-existing', lastDispatchAt: clock });
    });

    it('applies reset once, stops the live controller and clears local resume state', async () => {
        await seedLive();
        const event = payload();
        event.thread.resetAt = clock;
        runtime.dispatch(event);
        await started();
        expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
        const state = (await readThreadsState(home))['thread-1'];
        expect(state.resetAppliedAt).toBe(clock);
        expect(state.providerSessionId).toBeUndefined();
        expect(state.controlToken).not.toBe('existing-token');
        expect(state).toMatchObject({ lastRunId: event.runId, lastDispatchToken: event.dispatchToken });
        const second = payload('run-2'); second.thread.resetAt = clock;
        runtime.dispatch(second); await started(2);
        expect(deps.stopSession).toHaveBeenCalledTimes(2);
        expect(deps.spawnSession).toHaveBeenCalledTimes(2);
        expect((await readThreadsState(home))['thread-1'].lastRunId).toBe('run-2');
    });

    it('does not spawn or mark reset applied when stopping the old controller fails', async () => {
        await seedLive(); vi.mocked(deps.stopSession).mockResolvedValue(false);
        const event = payload(); event.thread.resetAt = clock;
        runtime.dispatch(event);
        await vi.waitFor(() => expect(deps.api.reportTeammateRunFinished).toHaveBeenCalled());
        expect(deps.spawnSession).not.toHaveBeenCalled();
        expect((await readThreadsState(home))['thread-1'].resetAppliedAt).toBeUndefined();
    });

    it('persists a channel dispatch and sends replies with the latest run credentials', async () => {
        await seedLive();
        const event = makeConversationPayload('group'); event.thread.id = 'thread-1';
        vi.mocked(deps.api.getChannelMessages).mockResolvedValueOnce([]).mockResolvedValueOnce([makeChannelMessage()]);
        vi.mocked(deps.api.sendTeammateChannelMessage).mockResolvedValue(makeChannelMessage(13));
        runtime.dispatch(event); await started();
        expect((await readThreadsState(home))['thread-1']).toMatchObject({
            lastRunId: event.runId, lastDispatchToken: event.dispatchToken, channel: event.channel, teammateName: 'Atlas',
        });
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('happy-existing', expect.stringContaining('New messages in group Engineering:'),
            expect.any(Uint8Array), 'teammate-run:run-chat', 'default', null, null);
        await runtime.chatSend({ threadId: 'thread-1', controlToken: 'existing-token', text: '@nova help', kind: 'text' });
        expect(deps.api.sendTeammateChannelMessage).toHaveBeenCalledWith(expect.objectContaining({
            runId: event.runId, dispatchToken: event.dispatchToken, localId: 'tm:run-chat:1', mentions: ['teammate-nova'],
        }));
        // Names resolve too, from the text (no space needed after CJK) or the mentions list; the owner is never a mention target.
        await runtime.chatSend({ threadId: 'thread-1', controlToken: 'existing-token', text: '请@Nova看下，@Alex 也看看', mentions: ['@Atlas'], kind: 'text' });
        expect(deps.api.sendTeammateChannelMessage).toHaveBeenLastCalledWith(expect.objectContaining({ mentions: ['teammate-atlas', 'teammate-nova'] }));
    });

    it('persists task configuration for restart and never reopens workers on a duplicate stopped dispatch', async () => {
        await seedLive();
        const event = payload();
        event.thread.kind = 'task'; event.thread.taskId = 'task-1';
        event.task = { id: 'task-1', teammateId: event.teammate.id, createdByTeammateId: null, source: 'github-issue', resourceId: 'owner/repo#42', title: 'Fix bug', url: null, status: 'in_progress', summary: null, prUrl: null, createdAt: 1, updatedAt: 1 };
        runtime.dispatch(event); await started();
        expect((await readThreadsState(home))['thread-1']).toMatchObject({ task: event.task, teammate: event.teammate });
        const auth = { threadId: 'thread-1', controlToken: 'existing-token' };
        expect(await createTeammateRuntime(deps).executeTool('work-session-list', auth)).toEqual({ workers: [] });
        await runtime.taskStop({ teammateId: event.teammate.id, taskId: event.task!.id, reason: 'paused' });
        expect(await runtime.dispatch(event)).toEqual({ ok: true });
        await expect(runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: 'Implement' })).rejects.toThrow('stopped');
        expect(deps.spawnSession).not.toHaveBeenCalled();
    });
    it('passes the controller permission and model in the delivered user message', async () => {
        await seedLive();
        const event = payload();
        Object.assign(event.teammate, { workerPermissionMode: 'acceptEdits', controllerPermissionMode: 'bypassPermissions', controllerModel: 'claude-opus-5-5-high' });
        runtime.dispatch(event); await started();
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('happy-1', expect.any(String), expect.any(Uint8Array),
            'teammate-run:run-1', 'bypassPermissions', 'claude-opus-5-5', 'high');
    });

    it('replaces a live controller on a provider switch without resuming the other provider transcript', async () => {
        await seedLive();
        const event = makeConversationPayload('dm'); event.thread.id = 'thread-1';
        Object.assign(event.teammate, { controllerProvider: 'codex', controllerPermissionMode: 'full-auto', controllerModel: 'gpt-6.1-sol-medium' });
        vi.mocked(deps.api.getChannelMessages).mockResolvedValueOnce([]).mockResolvedValueOnce([makeChannelMessage()]);
        runtime.dispatch(event); await started();
        expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', resumeSessionId: undefined }));
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('happy-1', expect.any(String), expect.any(Uint8Array),
            'teammate-run:run-chat', 'full-auto', 'gpt-6.1-sol', 'medium');
        const state = (await readThreadsState(home))['thread-1'];
        expect(state).toMatchObject({ provider: 'codex', controllerConfig: JSON.stringify(['codex', null]) });
        expect(state.providerSessionId).toBeUndefined();
    });

    it('decrypts the controller profile env with the machine key and replaces the controller when it changes', async () => {
        await seedLive();
        const env = { environmentVariables: { ANTHROPIC_BASE_URL: 'https://proxy.example' }, inheritMachineConfig: false };
        const event = payload();
        event.teammate.controllerEnv = encodeBase64(encryptWithDataKey(env, deps.machineKey!));
        runtime.dispatch(event); await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining(env));
    });

    it('fails the run instead of spawning when the profile env was sealed for another machine', async () => {
        const event = payload();
        event.teammate.controllerEnv = encodeBase64(encryptWithDataKey({ environmentVariables: {}, inheritMachineConfig: true }, new Uint8Array(32).fill(9)));
        runtime.dispatch(event);
        await vi.waitFor(() => expect(deps.api.reportTeammateRunFinished).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed' })));
        expect(deps.spawnSession).not.toHaveBeenCalled();
    });

    it('resumes the machine-local provider session when the pid is dead', async () => {
        await writeThreadsState(home, { 'thread-1': { pid: 999, providerSessionId: 'claude-old' } });
        const event = payload();
        event.thread.providerSessionId = 'ignored-server-id';
        runtime.dispatch(event);
        await started();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: undefined }));
        expect(deps.api.reportTeammateRunStarted).toHaveBeenCalledWith('run-1', expect.objectContaining({ resumed: false }));
    });

    it.each(['error', 'throw'])('reports spawn_failed for a spawn %s', async kind => {
        if (kind === 'error') vi.mocked(deps.spawnSession).mockResolvedValue({ type: 'error', errorMessage: 'Spawn refused' });
        else vi.mocked(deps.spawnSession).mockRejectedValue(new Error('Spawn refused'));
        runtime.dispatch(payload());
        await vi.waitFor(() => expect(deps.api.reportTeammateRunFinished).toHaveBeenCalledWith('run-1', {
            dispatchToken: 'token-run-1', status: 'failed', failureReason: 'spawn_failed', errorMessage: 'Spawn refused',
        }), { timeout: 5000 });
        expect(deps.api.reportTeammateRunStarted).not.toHaveBeenCalled();
    });

    it('reports unknown for a delivery error', async () => {
        await seedLive();
        vi.mocked(deps.api.sendSessionMessage).mockRejectedValue(new Error('Network unavailable'));
        runtime.dispatch(payload());
        await vi.waitFor(() => expect(deps.api.reportTeammateRunFinished).toHaveBeenCalledWith('run-1',
            expect.objectContaining({ status: 'failed', failureReason: 'unknown', errorMessage: 'Network unavailable' })), { timeout: 5000 });
    });

    it('serializes same-thread dispatches to spawn once', async () => {
        runtime.dispatch(payload());
        runtime.dispatch(payload('run-2'));
        await started(2);
        expect(deps.spawnSession).toHaveBeenCalledTimes(2);
        expect(deps.api.sendSessionMessage).toHaveBeenCalledTimes(2);
        expect(vi.mocked(deps.api.reportTeammateRunStarted).mock.calls.map(call => call[1].resumed)).toEqual([false, false]);
    });

    it('executes the same run id and dispatch token only once, including after completion', async () => {
        runtime.dispatch(payload());
        runtime.dispatch(payload());
        await started();
        runtime.dispatch(payload());
        // Wait through the thread queue using cancel, rather than a timing-only assertion.
        await runtime.cancel({ runId: 'run-1', dispatchToken: 'token-run-1' });
        expect(deps.spawnSession).toHaveBeenCalledTimes(1);
        expect(deps.api.sendSessionMessage).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid payloads and unsafe path ids without side effects', async () => {
        expect(await runtime.dispatch({})).toMatchObject({ ok: false });
        const event = payload();
        event.thread.id = '../escape';
        expect(await runtime.dispatch(event)).toMatchObject({ ok: false });
        expect(deps.spawnSession).not.toHaveBeenCalled();
    });

    it('cancels a tracked run, clears only pid, and never reports finished', async () => {
        await seedLive();
        runtime.dispatch(payload());
        await started();
        await runtime.cancel({ runId: 'run-1', dispatchToken: 'token-run-1' });
        expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
        expect((await readThreadsState(home))['thread-1']).toMatchObject({ providerSessionId: 'claude-existing', currentSessionId: 'happy-1' });
        expect((await readThreadsState(home))['thread-1'].pid).toBeUndefined();
        expect(deps.api.reportTeammateRunFinished).not.toHaveBeenCalled();
    });

    it('stops a session when cancellation arrives during spawn, without sending or reporting', async () => {
        let resolveSpawn!: (value: { type: 'success'; sessionId: string; pid: number }) => void;
        vi.mocked(deps.spawnSession).mockImplementation(() => new Promise(resolve => { resolveSpawn = resolve; }));
        runtime.dispatch(payload());
        await vi.waitFor(() => expect(deps.spawnSession).toHaveBeenCalled(), { timeout: 5000 });
        const cancelled = runtime.cancel({ runId: 'run-1', dispatchToken: 'token-run-1' });
        resolveSpawn({ type: 'success', sessionId: 'happy-new', pid: 123 });
        await cancelled;
        expect(deps.stopSession).toHaveBeenCalledWith('happy-new');
        expect(deps.api.sendSessionMessage).not.toHaveBeenCalled();
        expect(deps.api.reportTeammateRunStarted).not.toHaveBeenCalled();
        expect((await readThreadsState(home))['thread-1'].pid).toBeUndefined();
    });

    it('ignores cancellation with a different token and cancels before dispatch safely', async () => {
        await runtime.cancel({ runId: 'run-1', dispatchToken: 'token-run-1' });
        runtime.dispatch(payload());
        expect(deps.spawnSession).not.toHaveBeenCalled();
        runtime.dispatch(payload('run-2'));
        await started();
        await runtime.cancel({ runId: 'run-2', dispatchToken: 'wrong-token' });
        expect(deps.stopSession).not.toHaveBeenCalled();
    });

    it('reaps only idle, alive sessions without active runs and preserves provider ids', async () => {
        const idle = clock - 31 * 60_000;
        await writeThreadsState(home, {
            idle: { pid: 123, currentSessionId: 'idle', providerSessionId: 'claude-idle', lastDispatchAt: idle },
            active: { pid: 124, currentSessionId: 'active', lastDispatchAt: idle },
            recent: { pid: 125, currentSessionId: 'recent', lastDispatchAt: clock },
            dead: { pid: 999, currentSessionId: 'dead', lastDispatchAt: idle },
            unknown: { pid: 126, currentSessionId: 'unknown' },
        });
        vi.mocked(deps.api.getTeammateActiveSessions).mockResolvedValue({ sessionIds: ['active'] });
        await runtime.reapIdle();
        expect(deps.api.getTeammateActiveSessions).toHaveBeenCalledWith('machine-1');
        expect(deps.stopSession).toHaveBeenCalledTimes(1);
        expect(deps.stopSession).toHaveBeenCalledWith('idle');
        expect(deps.trackSession).toHaveBeenCalledTimes(1);
        expect(deps.trackSession).toHaveBeenCalledWith('idle', 123);
        const state = await readThreadsState(home);
        expect(state.idle).toEqual({ currentSessionId: 'idle', providerSessionId: 'claude-idle', lastDispatchAt: idle });
        expect(state.active.pid).toBe(124);
        await runtime.reapIdle();
        expect(deps.api.getTeammateActiveSessions).toHaveBeenCalledTimes(1);
    });

    it('does not stop sessions when the active-session lookup fails', async () => {
        await seedLive();
        vi.mocked(deps.api.getTeammateActiveSessions).mockRejectedValue(new Error('Offline'));
        await expect(runtime.reapIdle()).rejects.toThrow('Offline');
        expect(deps.stopSession).not.toHaveBeenCalled();
    });

    it('supports idle TTL override from environment', async () => {
        await seedLive();
        await mergeThreadState(home, 'thread-1', { lastDispatchAt: clock - 2000 });
        vi.stubEnv('HAPPY_TEAMMATE_IDLE_TTL_MS', '1000');
        try {
            await createTeammateRuntime({ ...deps, idleTtlMs: undefined }).reapIdle();
            expect(deps.stopSession).toHaveBeenCalledWith('happy-existing');
        } finally { vi.unstubAllEnvs(); }
    });
});

it('renders event timestamps in UTC, sorted oldest first, with missing-note fallback', async () => {
    const event = payload();
    event.events.unshift({ type: 'manual', at: Date.UTC(2026, 9, 8, 13), data: {} });
    expect(await renderRunEventMessage(event)).toBe('[Happy Agent run run-1 · trigger: manual · thread: heartbeat]\nEvents (oldest first):\n- 2026-10-08 12:00 manual: Review the repository\n- 2026-10-08 13:00 manual: (no note)');
    expect(event.events[0].at).toBe(Date.UTC(2026, 9, 8, 13));
});

it.each([
    ['claude', null, { model: null, reasoningEffort: null }],
    ['claude', 'default', { model: null, reasoningEffort: null }],
    ['claude', 'claude-opus-5-5-high-fast', { model: 'claude-opus-5-5-fast', reasoningEffort: 'high' }],
    ['codex', 'gpt-6.1-sol-medium', { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }],
    ['gemini', 'gemini-3.8-flash', { model: 'gemini-3.8-flash', reasoningEffort: null }],
    ['claude', 'custom-model', { model: 'custom-model', reasoningEffort: null }],
] as const)('resolves %s model mode %s like the app', (provider, mode, expected) => {
    expect(teammateModelSelection(provider, mode)).toEqual(expected);
});
