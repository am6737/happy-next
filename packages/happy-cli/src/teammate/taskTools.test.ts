import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeammateTask } from 'happy-wire';
import { createTeammateRuntime, type TeammateRuntimeDependencies } from './runtime';
import { mergeTaskWorker, readTaskState, writeThreadsState, readThreadsState } from './homeDir';
import { makeTeammate } from './testFixtures';
import { persistTeammateProviderSessionId } from './sessionHooks';
import { encodeBase64, encrypt } from '@/api/encryption';
import { dailyLogDate } from './dailyLogDate';
import { WORKER_RESULT_INSTRUCTION, WORKER_RESULT_REMINDER } from './workerResult';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
const task: TeammateTask = { id: 'task-12345678', teammateId: 'teammate-atlas', createdByTeammateId: null, source: 'github-issue', resourceId: 'owner/repo#42', title: 'Fix bug', url: 'https://github.com/owner/repo/issues/42', status: 'in_progress', summary: null, prUrl: null, createdAt: 1, updatedAt: 1 };
const auth = { threadId: 'task-thread', controlToken: 'controller-token' };

describe('task worker tools', () => {
    let dir: string;
    let home: string;
    let deps: TeammateRuntimeDependencies;
    let runtime: ReturnType<typeof createTeammateRuntime>;
    let nextSession: number;
    const teammate = makeTeammate({ workerProvider: 'claude', workerPermissionMode: 'bypassPermissions', model: 'claude-test' });
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'happy-task-tools-'));
        home = join(dir, teammate.id); nextSession = 0;
        await writeThreadsState(home, { [auth.threadId]: { ...auth, lastRunId: 'run-1', lastDispatchToken: 'dispatch-1', currentSessionId: 'controller', teammate, task, channel: null } });
        deps = {
            agentsDir: dir, machineId: 'machine', machineKey: null, now: () => new Date(2026, 9, 9, 12, 34).getTime(),
            api: {
                getGithubToken: vi.fn().mockResolvedValue('fresh-github-token'), registerTeammateSession: vi.fn(), getSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
                updateTeammateTask: vi.fn().mockResolvedValue({ task }), commentTeammateTask: vi.fn().mockResolvedValue({ url: 'https://github.com/comment' }), createTeammateTask: vi.fn(),
                sendSessionMessage: vi.fn().mockResolvedValue('sent'), reportTeammateRunStarted: vi.fn(), reportTeammateRunFinished: vi.fn(),
                getTeammateActiveSessions: vi.fn(), getChannelMessages: vi.fn(), sendTeammateChannelMessage: vi.fn(), push: vi.fn(),
            },
            spawnSession: vi.fn().mockImplementation(async () => ({ type: 'success', sessionId: `worker-${++nextSession}`, pid: 100 + nextSession })),
            fetch: vi.fn(async () => new Response('[]')),
            stopSession: vi.fn().mockReturnValue(true), trackSession: vi.fn(), isPidAlive: vi.fn(pid => pid !== 999),
            workspace: { exec: vi.fn().mockImplementation(async (_file, args) => {
                if (args[0] === 'clone') await mkdir(join(args[2], '.git'), { recursive: true });
                if (args[0] === 'show-ref') throw new Error('no branch');
                if (args[0] === 'worktree') await mkdir(args[4], { recursive: true });
                return { stdout: args[0] === 'symbolic-ref' ? 'refs/remotes/origin/main\n' : '' };
            }) },
        };
        runtime = createTeammateRuntime(deps);
    });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
    const start = () => runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: 'Implement and open draft PR' }) as Promise<{ sessionId: string; branch: string; worktreePath: string; warning?: string }>;

    it('spawns with worker credentials and metadata, registers and sends using raw permission mode/model', async () => {
        const result = await start();
        expect(result).toMatchObject({ sessionId: 'worker-1', branch: 'happy/atlas/12345678-1' });
        expect(result.warning).toBeUndefined();
        const options = vi.mocked(deps.spawnSession).mock.calls[0][0];
        expect(options).toMatchObject({ directory: result.worktreePath, agent: 'claude', sessionTitle: 'Atlas · Fix bug', worktreeBranchName: result.branch, worktreeBasePath: join(home, 'workspaces/owner/repo') });
        expect(options.extraEnv).toMatchObject({ HAPPY_TEAMMATE_ID: teammate.id, HAPPY_TEAMMATE_THREAD_ID: auth.threadId, HAPPY_TEAMMATE_SESSION_ROLE: 'worker', HAPPY_TEAMMATE_TASK_ID: task.id, HAPPY_TEAMMATE_HOME: home,
            GITHUB_PERSONAL_ACCESS_TOKEN: 'fresh-github-token', GH_TOKEN: 'fresh-github-token', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: join(home, 'state', 'githooks'), HAPPY_TEAMMATE_READ_ONLY: '' });
        expect(options.extraEnv!.PATH.split(delimiter)[0]).toBe(join(home, 'state', 'bin'));
        expect(options.extraEnv).not.toHaveProperty('HAPPY_TEAMMATE_CONTROL_TOKEN');
        expect(options.extraEnv).not.toHaveProperty('HAPPY_TEAMMATE_SYSTEM_PROMPT_FILE');
        expect(JSON.parse(options.extraEnv!.HAPPY_TEAMMATE_EXTERNAL_CONTEXT)).toEqual({ source: 'github', resourceType: 'issue', resourceId: task.resourceId, title: task.title, deepLink: '/repos/owner/repo/issue/42' });
        expect((await stat(options.extraEnv!.HAPPY_SESSION_DATA_KEY_FILE)).mode & 0o777).toBe(0o600);
        expect(deps.api.registerTeammateSession).toHaveBeenCalledWith({ runId: 'run-1', dispatchToken: 'dispatch-1', sessionId: 'worker-1', role: 'worker' });
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('worker-1', 'Implement and open draft PR' + WORKER_RESULT_INSTRUCTION, expect.any(Uint8Array), `tm-work:${task.id}:1`, 'bypassPermissions', 'claude-test', null);
        const state = await readTaskState(home, task.id);
        expect(state.sendCounter).toBe(1);
        expect(state.workers[options.extraEnv!.HAPPY_TEAMMATE_WORKER_ID]).toMatchObject({ sessionId: 'worker-1', pid: 101, provider: 'claude', repo: 'owner/repo', title: 'Atlas · Fix bug', branch: result.branch, lastSentAt: deps.now!() });
        expect((await stat(join(home, 'state/tasks', `${task.id}.json`))).mode & 0o777).toBe(0o600);
    });
    it('continues an existing Claude worker, reuses worktree, refreshes token and preserves provider ID', async () => {
        const first = await start();
        const env = vi.mocked(deps.spawnSession).mock.calls[0][0].extraEnv!;
        await persistTeammateProviderSessionId('claude-provider-1', env);
        const result = await runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: 'Continue', continueFrom: first.sessionId });
        expect(result).toMatchObject({ sessionId: 'worker-2', branch: first.branch, worktreePath: first.worktreePath });
        expect(deps.stopSession).toHaveBeenCalledWith('worker-1');
        expect(deps.api.getGithubToken).toHaveBeenCalledTimes(2);
        expect(vi.mocked(deps.spawnSession).mock.calls[1][0].resumeSessionId).toBe('claude-provider-1');
        expect((await readTaskState(home, task.id)).workers[env.HAPPY_TEAMMATE_WORKER_ID]).toMatchObject({ providerSessionId: 'claude-provider-1', stoppedAt: deps.now!() });
        // The continued worker is its own record: its session, key and liveness must not be inherited from the stopped one.
        const nextEnv = vi.mocked(deps.spawnSession).mock.calls[1][0].extraEnv!;
        const next = (await readTaskState(home, task.id)).workers[nextEnv.HAPPY_TEAMMATE_WORKER_ID];
        expect(next).toMatchObject({ sessionId: 'worker-2', keyPath: nextEnv.HAPPY_SESSION_DATA_KEY_FILE, branch: first.branch });
        expect(next).not.toHaveProperty('stoppedAt');
        expect(next).not.toHaveProperty('providerSessionId');
        await expect(runtime.executeTool('work-session-read', { ...auth, sessionId: 'worker-2' })).resolves.toMatchObject({ status: 'idle', transcript: '', result: { reply: null } });
        expect((await readThreadsState(home))[auth.threadId].providerSessionId).toBeUndefined();
    });
    it('warns and starts without a token when GitHub is unavailable', async () => {
        vi.mocked(deps.api.getGithubToken).mockRejectedValue(new Error('not connected'));
        expect((await start()).warning).toContain('GitHub');
        const env = vi.mocked(deps.spawnSession).mock.calls[0][0].extraEnv!;
        expect(env).not.toHaveProperty('GH_TOKEN'); expect(env).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath' });
    });
    it('pins only the built-in Codex review of a review task to read-only, and only where Codex can sandbox', async () => {
        const reviewer = { ...teammate, workerProvider: 'codex' as const };
        await writeThreadsState(home, { [auth.threadId]: { ...auth, lastRunId: 'run-1', lastDispatchToken: 'dispatch-1', currentSessionId: 'controller', teammate: reviewer, task: { ...task, parentTaskId: 'task-parent' }, channel: null } });
        let sandboxWorks = true;
        runtime = createTeammateRuntime({ ...deps, codexSandboxWorks: async () => sandboxWorks });
        await runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: '/review base origin/main' });
        await runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: 'gh pr checkout 7 and review it' });
        sandboxWorks = false;
        await runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: '/review base origin/main' });
        expect(vi.mocked(deps.spawnSession).mock.calls.map(([options]) => options.extraEnv!.HAPPY_TEAMMATE_READ_ONLY)).toEqual(['1', '', '']);
        // A review reports a review, not a happy-result block, and its worker is not checked against the PR.
        expect(vi.mocked(deps.api.sendSessionMessage).mock.calls.map(call => call[1])).toEqual(['/review base origin/main', 'gh pr checkout 7 and review it', '/review base origin/main']);
        expect(Object.values((await readTaskState(home, task.id)).workers).every(worker => worker.review)).toBe(true);
        await runtime.executeTool('work-session-send', { ...auth, sessionId: 'worker-2', text: 'Check the tests too' });
        expect(deps.api.sendSessionMessage).toHaveBeenLastCalledWith('worker-2', 'Check the tests too', expect.anything(), expect.anything(), expect.anything(), expect.anything(), null);
        expect(await runtime.executeTool('work-session-read', { ...auth, sessionId: 'worker-1' })).toEqual({ status: 'idle', transcript: '', result: { reply: null } });
        expect(deps.fetch).not.toHaveBeenCalled();
    });
    it.each(['codex', 'gemini'] as const)('keeps raw provider permission mode for %s', async provider => {
        const configuration = { ...teammate, workerProvider: provider, workerPermissionMode: provider === 'codex' ? 'full-auto' as const : 'yolo' as const };
        await writeThreadsState(home, { [auth.threadId]: { controlToken: auth.controlToken, lastRunId: 'run', lastDispatchToken: 'dispatch', teammate: configuration, task } });
        await start();
        expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ agent: provider }));
        expect(deps.api.sendSessionMessage).toHaveBeenCalledWith('worker-1', expect.any(String), expect.any(Uint8Array), expect.any(String), configuration.workerPermissionMode, teammate.model, null);
    });
    it('sends, reads, lists and stops only this task workers with durable counters', async () => {
        await start();
        expect(await runtime.executeTool('work-session-send', { ...auth, sessionId: 'worker-1', text: 'Run tests' })).toEqual({ delivery: 'sent' });
        expect(deps.api.sendSessionMessage).toHaveBeenLastCalledWith('worker-1', 'Run tests' + WORKER_RESULT_REMINDER, expect.any(Uint8Array), `tm-work:${task.id}:2`, 'bypassPermissions', 'claude-test', null);
        const key = vi.mocked(deps.api.sendSessionMessage).mock.calls[0][2];
        const reply = 'Tests pass\n```happy-result\n{"status":"done","checks":[{"command":"yarn test","passed":true}]}\n```';
        vi.mocked(deps.api.getSessionMessages).mockResolvedValue({ messages: [{ seq: 1, content: { t: 'encrypted', c: encodeBase64(encrypt(key, 'dataKey', { role: 'agent', content: { type: 'codex', data: { type: 'message', message: reply } } })) } }] });
        expect(await runtime.executeTool('work-session-read', { ...auth, sessionId: 'worker-1' })).toEqual({ status: 'idle', transcript: `assistant: ${reply}`, result: {
            reply: 'Tests pass', report: { status: 'done', checks: [{ command: 'yarn test', passed: true }] },
            facts: { branch: 'happy/atlas/12345678-1', head: '', uncommittedFiles: 0, pushed: true, diff: 'no changes', pr: null },
        } });
        expect(deps.fetch).toHaveBeenCalledWith(expect.stringContaining('head=owner%3Ahappy%2Fatlas%2F12345678-1'), expect.anything());
        vi.mocked(deps.api.getSessionMessages).mockResolvedValueOnce({ messages: [], busy: true });
        expect(await runtime.executeTool('work-session-read', { ...auth, sessionId: 'worker-1' })).toMatchObject({ status: 'running', note: expect.stringContaining('Do not poll') });
        expect(deps.api.getSessionMessages).toHaveBeenCalledWith('worker-1', 40);
        expect(await runtime.executeTool('work-session-list', auth)).toMatchObject({ workers: [{ sessionId: 'worker-1', alive: true, lastSentAt: deps.now!() }] });
        for (const path of ['work-session-send', 'work-session-read', 'work-session-stop'] as const) await expect(runtime.executeTool(path, { ...auth, sessionId: 'foreign', text: 'x' })).rejects.toThrow('does not belong');
        expect(await runtime.executeTool('work-session-stop', { ...auth, sessionId: 'worker-1' })).toEqual({ ok: true });
        await expect(runtime.executeTool('work-session-send', { ...auth, sessionId: 'worker-1', text: 'again' })).rejects.toThrow('worker ended; call work_session_start with continueFrom');
    });
    it('rejects a dead worker, invalid repo, foreign continueFrom and bad auth', async () => {
        await start();
        const workerId = Object.keys((await readTaskState(home, task.id)).workers)[0];
        await mergeTaskWorker(home, task.id, workerId, { pid: 999 });
        await expect(runtime.executeTool('work-session-send', { ...auth, sessionId: 'worker-1', text: 'hi' })).rejects.toThrow('worker ended');
        await expect(runtime.executeTool('work-session-start', { ...auth, repo: 'other/repo', prompt: 'hi' })).rejects.toThrow('must match');
        await expect(runtime.executeTool('work-session-start', { ...auth, repo: 'owner/repo', prompt: 'hi', continueFrom: 'foreign' })).rejects.toThrow('does not belong');
        await expect(runtime.executeTool('work-session-list', { ...auth, controlToken: 'wrong' })).rejects.toThrow('Invalid teammate control token');
    });
    it('stops workers idempotently through the RPC and validates path IDs', async () => {
        await start(); await start();
        expect(await runtime.taskStop({ teammateId: teammate.id, taskId: task.id, reason: 'paused' })).toEqual({ ok: true });
        expect(deps.stopSession).toHaveBeenCalledTimes(2);
        expect(deps.trackSession).toHaveBeenCalledWith('worker-1', 101);
        expect(Object.values((await readTaskState(home, task.id)).workers).every(worker => !worker.pid && worker.stoppedAt === deps.now!())).toBe(true);
        await runtime.taskStop({ teammateId: teammate.id, taskId: task.id, reason: 'cancelled' });
        expect(deps.stopSession).toHaveBeenCalledTimes(2);
        expect(await runtime.taskStop({ teammateId: '../bad', taskId: task.id, reason: 'done' })).toMatchObject({ ok: false });
        await expect(start()).rejects.toThrow('stopped');
    });
    it('stops a process when task-stop arrives during spawn, before registration or first message', async () => {
        let finish!: (result: { type: 'success'; sessionId: string; pid: number }) => void;
        vi.mocked(deps.spawnSession).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const pending = start();
        const assertion = expect(pending).rejects.toThrow('stopped');
        await vi.waitFor(() => expect(deps.spawnSession).toHaveBeenCalled());
        const stopping = runtime.taskStop({ teammateId: teammate.id, taskId: task.id, reason: 'paused' });
        finish({ type: 'success', sessionId: 'pending-worker', pid: 101 });
        await assertion; await stopping;
        expect(deps.stopSession).toHaveBeenCalledWith('pending-worker');
        expect(deps.api.registerTeammateSession).not.toHaveBeenCalled();
        expect(deps.api.sendSessionMessage).not.toHaveBeenCalled();
    });
    it('cleans up when registration fails', async () => {
        vi.mocked(deps.api.registerTeammateSession).mockRejectedValue(new Error('run expired'));
        await expect(start()).rejects.toThrow('run expired');
        expect(deps.stopSession).toHaveBeenCalledWith('worker-1');
        expect(deps.api.sendSessionMessage).not.toHaveBeenCalled();
    });
    it('permits a synchronous done-update task-stop callback without deadlocking', async () => {
        await start();
        vi.mocked(deps.api.updateTeammateTask).mockImplementation(async () => {
            await runtime.taskStop({ teammateId: teammate.id, taskId: task.id, reason: 'done' });
            return { task: { ...task, status: 'done' } };
        });
        expect(await runtime.executeTool('task-update', { ...auth, status: 'done' })).toMatchObject({ task: { status: 'done' } });
        expect(deps.stopSession).toHaveBeenCalledWith('worker-1');
        await expect(runtime.executeTool('task-update', auth)).rejects.toThrow();
    });
    it('allows memory in non-task controllers with no channel', async () => {
        await writeThreadsState(home, { [auth.threadId]: { controlToken: auth.controlToken, lastRunId: 'run-heartbeat', task: null, channel: null } });
        expect(await runtime.executeTool('memory-note', { ...auth, text: 'Heartbeat learning' })).toEqual({ ok: true });
        await expect(runtime.executeTool('work-session-list', auth)).rejects.toThrow('requires a task');
    });
    it('forwards task updates and comments with run credentials and appends memory with one header', async () => {
        expect(await runtime.executeTool('task-update', { ...auth, status: 'in_review', summary: 'Ready', prUrl: 'https://github.com/pr', verdict: 'approved' })).toEqual({ task });
        expect(deps.api.updateTeammateTask).toHaveBeenCalledWith({ runId: 'run-1', dispatchToken: 'dispatch-1', status: 'in_review', summary: 'Ready', prUrl: 'https://github.com/pr', verdict: 'approved' });
        await expect(runtime.executeTool('task-update', { ...auth, verdict: 'changes_requested' })).rejects.toThrow('summary is required');
        expect(await runtime.executeTool('task-comment', { ...auth, body: 'Claiming' })).toEqual({ url: 'https://github.com/comment' });
        expect(deps.api.commentTeammateTask).toHaveBeenCalledWith({ runId: 'run-1', dispatchToken: 'dispatch-1', body: 'Claiming' });
        await runtime.executeTool('memory-note', { ...auth, text: 'Verified behavior.' });
        await runtime.executeTool('memory-note', { ...auth, text: 'Follow-up.' });
        const date = dailyLogDate(new Date(deps.now!()));
        expect(await readFile(join(home, 'memory', `${date}.md`), 'utf8')).toBe(`# ${date}\n\n- 12:34 Verified behavior. (run run-1, session controller)\n- 12:34 Follow-up. (run run-1, session controller)\n`);
    });
});
