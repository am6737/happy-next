import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { TeammateRunDispatchPayloadSchema } from 'happy-wire';
import type { Fastify } from '@/app/api/types';

const { dbMock, state, systemMessage, rpc, online, github, reaction, comment, listComments } = vi.hoisted(() => {
    const state = { teammates: [] as any[], threads: [] as any[], runs: [] as any[], sessions: [] as any[], registrations: [] as any[], machine: null as any, committed: false, failCommit: false, seq: 0, channel: null as any, tasks: [] as any[], messages: [] as any[] };
    const expand = (row: any) => row ? { ...row, teammate: state.teammates.find(t => t.id === row.teammateId), thread: state.threads.find(t => t.id === row.threadId) } : null;
    const matches = (row: any, where: any): boolean => !where || Object.entries(where).every(([key, expected]: [string, any]) => {
        if (key === 'AND') return expected.every((w: any) => matches(row, w));
        if (key === 'thread') return matches(state.threads.find(t => t.id === row.threadId), expected);
        if (key === 'members') return row.members.some((m: any) => matches(m, expected.some));
        if (key === 'channelId_localId') return matches(row, expected);
        if (key === 'teammate') return matches(state.teammates.find(t => t.id === row.teammateId), expected);
        if (!row) return false;
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
            if ('in' in expected) return expected.in.includes(row[key]);
            if ('notIn' in expected) return !expected.notIn.includes(row[key]);
            if ('not' in expected) return row[key] !== expected.not;
            if ('lt' in expected) return row[key] < expected.lt;
        }
        return row[key] === expected;
    });
    const findRun = vi.fn(async (args: any) => expand(state.runs.find(r => matches(r, args.where))));
    const dbMock = {
        channel: {
            findFirst: vi.fn(async ({ where }: any) => matches(state.channel, where) ? state.channel : null),
            findUnique: vi.fn(async () => state.channel),
            update: vi.fn(async () => { state.channel.seq++; return state.channel; }),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        channelMessage: {
            findUnique: vi.fn(async ({ where }: any) => state.messages.find(m => matches(m, where)) ?? null),
            create: vi.fn(async ({ data }: any) => { const row = { id: `msg_${state.messages.length}`, createdAt: new Date(), ...data }; state.messages.push(row); return row; }),
        },
        teammateTask: {
            findFirst: vi.fn(async ({ where, include }: any) => { const row = state.tasks.find(t => matches(t, where)); return row ? { ...row, ...(include?.teammate ? { teammate: state.teammates.find(t => t.id === row.teammateId) } : {}) } : null; }),
            findUnique: vi.fn(async ({ where, include }: any) => { const row = state.tasks.find(t => matches(t, where)); return row ? { ...row, ...(include?.teammate ? { teammate: state.teammates.find(t => t.id === row.teammateId) } : {}) } : null; }),
            findMany: vi.fn(async ({ where }: any) => state.tasks.filter(t => matches(t, where)).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))),
            create: vi.fn(async ({ data }: any) => { const row = { id: `task_${state.tasks.length}`, summary: null, prUrl: null, url: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.tasks.push(row); return { ...row }; }),
            update: vi.fn(async ({ where, data }: any) => { const row = state.tasks.find(t => matches(t, where)); Object.assign(row, data); return { ...row }; }),
        },
        teammate: { findUnique: vi.fn(async ({ where }: any) => state.teammates.find(t => matches(t, where)) ?? null), findFirst: vi.fn(async ({ where }: any) => state.teammates.find(t => matches(t, where)) ?? null) },
        teammateThread: {
            findFirst: vi.fn(async ({ where }: any) => state.threads.find(t => matches(t, where)) ?? null),
            create: vi.fn(async ({ data }: any) => { const row = { id: `thread_${state.threads.length + 1}`, channelId: null, taskId: null, currentSessionId: null, providerSessionId: null, lastActiveAt: new Date(), ...data }; state.threads.push(row); return row; }),
            update: vi.fn(async ({ where, data }: any) => { const row = state.threads.find(t => matches(t, where)); Object.assign(row, data); return row; }),
        },
        teammateRun: {
            findFirst: findRun, findUnique: findRun,
            findMany: vi.fn(async ({ where, orderBy, take }: any) => { const rows = state.runs.filter(r => matches(r, where)); if (orderBy) rows.sort((a, b) => orderBy[0].queuedAt === 'desc' ? b.queuedAt - a.queuedAt || b.id.localeCompare(a.id) : a.queuedAt - b.queuedAt); return rows.slice(0, take).map(expand); }),
            count: vi.fn(async ({ where }: any) => state.runs.filter(r => matches(r, where)).length),
            updateMany: vi.fn(async ({ where, data }: any) => { const rows = state.runs.filter(r => matches(r, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length }; }),
            update: vi.fn(async ({ where, data }: any) => { const row = state.runs.find(r => matches(r, where)); Object.assign(row, data); return expand(row); }),
            create: vi.fn(async ({ data }: any) => { const row = { id: `new_run_${state.runs.length + 1}`, queuedAt: new Date(), startedAt: null, finishedAt: null, sessionId: null, failureReason: null, taskId: null, costUsd: null, ...data }; state.runs.push(row); return expand(row); }),
        },
        teammateSession: {
            findUnique: vi.fn(async ({ where }: any) => state.registrations.find(r => matches(r, where)) ?? null),
            findMany: vi.fn(async ({ where }: any) => state.registrations.filter(r => matches(r, where)).sort((a, b) => a.createdAt - b.createdAt)),
            upsert: vi.fn(async ({ where, create, update }: any) => { const row = state.registrations.find(r => matches(r, where)); if (row) { Object.assign(row, update); return row; } const created = { createdAt: new Date(), ...create }; state.registrations.push(created); return created; }),
        },
        session: { findUnique: vi.fn(async ({ where }: any) => state.sessions.find(s => matches(s, where)) ?? null), findFirst: vi.fn(async ({ where }: any) => state.sessions.find(s => matches(s, where)) ?? null) },
        machine: { findUnique: vi.fn(async () => state.machine) },
        account: { update: vi.fn(async () => ({ seq: ++state.seq })) },
        $transaction: vi.fn(async (fn: any) => { state.committed = false; const result = await fn(dbMock); if (state.failCommit) throw new Error('commit failed'); state.committed = true; return result; }),
    };
    return { dbMock, state, systemMessage: vi.fn(), rpc: vi.fn(), online: vi.fn(), github: vi.fn(), reaction: vi.fn(), comment: vi.fn(), listComments: vi.fn() };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({ getPublicUrl: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/api/socket/rpcRegistry', () => ({ invokeUserRpc: rpc, hasUserRpcMethod: online }));
vi.mock('@/app/channel/channelSystemMessage', () => ({ channelSystemMessage: systemMessage }));

vi.mock('@/app/github/githubApi', () => ({ getUserOctokit: github, GitHubNotConnectedError: class GitHubNotConnectedError extends Error {} }));

import { eventRouter } from '@/app/events/eventRouter';
import { teammateRunStart } from './teammateRunStart';
import { teammateRunPick } from './teammateRunScheduler';
import { teammateOnSessionTurnEnded } from './teammateOnSessionTurnEnded';
import { teammateSessionCacheInvalidate } from './teammateSessionCache';
import { __resetSessionTurnRuntimeForTests } from '@/app/presence/sessionTurnRuntime';

import { teammateTaskDelegate } from './teammateTaskDelegate';
import { teammateTaskWake, TEAMMATE_TASK_MAX_RUNS } from './teammateTaskWake';
import { teammateTaskAgentUpdate } from './teammateTaskAgentUpdate';
import { teammateTaskComment } from './teammateTaskComment';
import { teammateSessionRegister } from './teammateSessionRegister';
import { teammateTaskStop } from './teammateTaskStop';
import { teammateTaskResume } from './teammateTaskResume';
import { teammateTaskCancel } from './teammateTaskCancel';
import { teammateTaskListByResource, teammateTaskDetail } from './teammateTaskQueries';
import { teammateSessionLookup } from './teammateSessionCache';
import { teammateTaskRoutes } from '@/app/api/routes/teammateTaskRoutes';
import { channelRoutes } from '@/app/api/routes/channelRoutes';
import { channelMessageSend } from '@/app/channel/channelMessageSend';
import { channelTeammateMessageSend } from '@/app/channel/channelTeammateMessageSend';
import { GitHubNotConnectedError } from '@/app/github/githubApi';
const now = new Date('2026-10-09T12:00:00.000Z');
const event = { type: 'manual' as const, at: now.getTime(), data: { note: 'Review the queue' } };
const profile = {
    id: 'mate', accountId: 'account', handle: 'atlas', name: 'Atlas', avatar: null, role: 'Engineer', skills: ['typescript'], repos: ['owner/repo'], instructions: 'Ship small changes', machineId: 'machine', controllerProvider: 'claude', controllerModel: null, controllerPermissionMode: 'default', controllerProfileId: null, controllerEnv: null, workerProvider: 'claude', model: null, workerPermissionMode: 'default', workerProfileId: null, workerEnv: null, maxConcurrentRuns: 3, monthlyBudgetUsd: null, heartbeatIntervalMin: null, activeHours: null, dreamingHour: null, canSelfAssign: false, status: 'active', createdAt: now, updatedAt: now,
};
const thread = { resetAt: null, id: 'thread', teammateId: 'mate', kind: 'heartbeat', channelId: null, taskId: null, currentSessionId: null, providerSessionId: 'local-only', lastActiveAt: now };
function addRun(overrides: any = {}) {
    const row = { id: `run_${state.runs.length + 1}`, teammateId: 'mate', threadId: 'thread', trigger: 'manual', eventPayload: { events: [event] }, status: 'queued', attempt: 1, dispatchToken: 'secret', failureReason: null, sessionId: null, taskId: null, costUsd: null, queuedAt: now, startedAt: null, finishedAt: null, ...overrides };
    state.runs.push(row);
    return row;
}
const started = { dispatchToken: 'secret', sessionId: 'session', resumed: false, delivery: 'sent' as const };

beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
    state.teammates = [{ ...profile }]; state.threads = [{ ...thread }]; state.runs = []; state.sessions = [{ id: 'session', accountId: 'account', active: true, lastActiveAt: now }]; state.registrations = []; state.machine = { lastActiveAt: now }; state.committed = false; state.failCommit = false; state.seq = 0; state.channel = null; state.tasks = []; state.messages = [];
    for (const id of ['session', 'ordinary', 'worker']) teammateSessionCacheInvalidate(id);
    __resetSessionTurnRuntimeForTests();
    online.mockReturnValue(true); rpc.mockResolvedValue({ ok: true });
    github.mockResolvedValue({ rest: { reactions: { createForIssue: reaction }, issues: { createComment: comment, listComments } } });
    listComments.mockResolvedValue({ data: [] });
    reaction.mockResolvedValue({}); comment.mockResolvedValue({ data: { html_url: 'https://github.com/owner/repo/issues/123#issuecomment-1' } });
    vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => { expect(state.committed).toBe(true); return { total: 1, sessionScoped: 0 }; });
});
afterEach(() => vi.useRealTimers());

const delegate = { teammateId: 'mate', source: 'github-issue' as const, resourceId: 'owner/repo#123', title: 'Fix race', url: 'https://github.com/owner/repo/issues/123' };
const auth = { runId: 'run_1', dispatchToken: 'secret' };
function setupTask(status = 'in_progress') {
    const task = { id: 'task', accountId: 'account', teammateId: 'mate', source: 'github-issue', resourceId: 'owner/repo#123', title: 'Fix race', url: delegate.url, summary: null, prUrl: null, status, createdAt: now, updatedAt: now };
    state.tasks.push(task);
    Object.assign(state.threads[0], { kind: 'task', taskId: task.id });
    return task;
}
function setupDm() {
    state.channel = { id: 'dm', accountId: 'account', kind: 'dm', title: null, brief: null, seq: 0, lastMessageAt: now, members: [
        { memberType: 'user', accountId: 'account', teammateId: null, lastReadSeq: 0, encryptedDataKey: new Uint8Array([1, 2]), account: { firstName: 'Ada' } },
        { memberType: 'teammate', teammateId: 'mate', accountId: null, lastReadSeq: 0, encryptedDataKey: new Uint8Array([3, 4]), teammate: state.teammates[0] },
    ] };
}
const messageReq = { localId: 'reply', kind: 'text' as const, content: { t: 'encrypted' as const, c: 'ciphertext' }, mentions: [] };
async function userReply(taskId = 'task') {
    return channelMessageSend({ accountId: 'account', channelId: 'dm', sender: { type: 'user', accountId: 'account' }, req: { ...messageReq, taskId } });
}
async function daemonMessage(overrides: any = {}) {
    return channelTeammateMessageSend('account', { ...auth, ...messageReq, ...overrides });
}

beforeEach(() => {
    rpc.mockImplementation(async () => { expect(state.committed).toBe(true); return { ok: true }; });
    github.mockImplementation(async () => { expect(state.committed).toBe(true); return { rest: { reactions: { createForIssue: reaction }, issues: { createComment: comment, listComments } } }; });
});

describe('task delegation', () => {
    it('creates task/thread/run in one transaction and acknowledges after commit; repeats are a no-op', async () => {
        reaction.mockImplementation(async () => { expect(state.committed).toBe(true); return {}; });
        const task = await teammateTaskDelegate('account', delegate);
        expect(task).toMatchObject({ teammateId: 'mate', status: 'todo', resourceId: delegate.resourceId });
        expect(state.threads[1]).toMatchObject({ kind: 'task', taskId: task.id });
        expect(state.runs).toMatchObject([{ status: 'queued', trigger: 'task-assigned', taskId: task.id, threadId: state.threads[1].id }]);
        expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
        expect(reaction).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', issue_number: 123, content: 'eyes' });
        expect(await teammateTaskDelegate('account', delegate)).toEqual(task);
        expect(state.tasks).toHaveLength(1); expect(state.runs).toHaveLength(1); expect(reaction).toHaveBeenCalledTimes(1);
        expect(vi.mocked(eventRouter.emitUpdate).mock.calls.find(([e]) => e.payload.body.t === 'teammate-task-updated')?.[0]).toMatchObject({ userId: 'account', recipientFilter: { type: 'user-scoped-only' }, payload: { body: { t: 'teammate-task-updated', task } } });
    });
    it('rejects assigning an open issue to another Agent', async () => {
        await teammateTaskDelegate('account', delegate); state.teammates.push({ ...profile, id: 'other' });
        await expect(teammateTaskDelegate('account', { ...delegate, teammateId: 'other' })).rejects.toMatchObject({ code: 'already_delegated' });
    });
    it.each(['done', 'cancelled'])('allows new delegation after %s', async status => {
        await teammateTaskDelegate('account', delegate); state.tasks[0].status = status;
        await teammateTaskDelegate('account', delegate); expect(state.tasks).toHaveLength(2); expect(state.runs).toHaveLength(2);
    });
    it.each(['foreign', 'archived'])('validates %s Agent', async mode => {
        if (mode === 'foreign') state.teammates[0].accountId = 'foreign'; else state.teammates[0].status = 'archived';
        await expect(teammateTaskDelegate('account', delegate)).rejects.toMatchObject({ code: mode === 'foreign' ? 'not_found' : 'archived' });
        expect(state.tasks).toHaveLength(0);
    });
    it('ignores acknowledgement failures including missing GitHub connection', async () => {
        github.mockRejectedValueOnce(new GitHubNotConnectedError());
        await expect(teammateTaskDelegate('account', delegate)).resolves.toMatchObject({ status: 'todo' });
        state.tasks[0].status = 'done'; reaction.mockRejectedValueOnce(new Error('GitHub offline'));
        await expect(teammateTaskDelegate('account', delegate)).resolves.toMatchObject({ status: 'todo' });
    });
    it('emits no events and calls no GitHub API on commit failure', async () => {
        state.failCommit = true;
        await expect(teammateTaskDelegate('account', delegate)).rejects.toThrow('commit failed');
        expect(eventRouter.emitUpdate).not.toHaveBeenCalled(); expect(github).not.toHaveBeenCalled();
    });
});

describe('task run start and worker wake', () => {
    it('registers the controller task and moves todo to in_progress once', async () => {
        const task = setupTask('todo'); addRun({ status: 'dispatching', taskId: task.id });
        await teammateRunStart('run_1', started, 'account'); await teammateRunStart('run_1', started, 'account');
        expect(task.status).toBe('in_progress'); expect(state.registrations[0]).toMatchObject({ role: 'controller', taskId: task.id });
        expect(dbMock.teammateTask.update).toHaveBeenCalledTimes(1);
    });
    it('worker turn ends coalesce on the parent task thread', async () => {
        setupTask(); state.registrations.push({ sessionId: 'worker', role: 'worker', teammateId: 'mate', threadId: 'thread', taskId: 'task' });
        await teammateOnSessionTurnEnded('worker'); await teammateOnSessionTurnEnded('worker');
        expect(state.runs).toHaveLength(1);
        expect(state.runs[0]).toMatchObject({ taskId: 'task', threadId: 'thread', trigger: 'work-session-idle', eventPayload: { events: [
            { type: 'work-session-idle', data: { taskId: 'task', sessionId: 'worker' } }, { type: 'work-session-idle', data: { taskId: 'task', sessionId: 'worker' } },
        ] } });
    });
    it.each(['paused', 'cancelled', 'done'])('%s drops worker wake', async status => {
        setupTask(status); state.registrations.push({ sessionId: 'worker', role: 'worker', taskId: 'task' });
        await teammateOnSessionTurnEnded('worker'); expect(state.runs).toHaveLength(0); expect(rpc).not.toHaveBeenCalled();
    });
    it('sixty runs pause execution, cancel pending work, and stop workers once', async () => {
        const task = setupTask();
        for (let i = 0; i < TEAMMATE_TASK_MAX_RUNS; i++) addRun({ taskId: 'task', status: i === 0 ? 'running' : 'completed' });
        await teammateTaskWake('task', event); await teammateTaskWake('task', event);
        expect(task).toMatchObject({ status: 'paused', summary: 'Run limit reached' }); expect(state.runs).toHaveLength(60); expect(state.runs[0].status).toBe('cancelled');
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-task-stop', { teammateId: 'mate', taskId: 'task', reason: 'run_limit' }, 30_000);
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-run-cancel', expect.objectContaining({ runId: 'run_1' }), 30_000);
        expect(rpc).toHaveBeenCalledTimes(2);
    });
    it('fifty-nine runs still allow the sixtieth', async () => {
        setupTask(); for (let i = 0; i < 59; i++) addRun({ taskId: 'task', status: 'completed' });
        await teammateTaskWake('task', event); expect(state.runs).toHaveLength(60); expect(state.tasks[0].status).toBe('in_progress');
    });
    it('ensures a missing task thread when waking', async () => {
        setupTask(); state.threads = []; await teammateTaskWake('task', event);
        expect(state.threads[0]).toMatchObject({ kind: 'task', taskId: 'task' }); expect(state.runs[0].threadId).toBe(state.threads[0].id);
    });
});

describe('agent task updates', () => {
    it.each(['in_progress', 'awaiting_input', 'in_review', 'done'] as const)('accepts %s with summary and PR; done stops workers', async status => {
        setupTask(); addRun({ status: 'running', taskId: 'task' });
        const task = await teammateTaskAgentUpdate('account', { ...auth, status, summary: 'Ready', prUrl: 'https://github.com/owner/repo/pull/9' });
        expect(task).toMatchObject({ status, summary: 'Ready', prUrl: 'https://github.com/owner/repo/pull/9' });
        if (status === 'done') expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-task-stop', { teammateId: 'mate', taskId: 'task', reason: 'done' }, 30_000);
        else expect(rpc).not.toHaveBeenCalled();
        await teammateTaskAgentUpdate('account', { ...auth, status, summary: 'Ready', prUrl: 'https://github.com/owner/repo/pull/9' });
        expect(dbMock.teammateTask.update).toHaveBeenCalledTimes(1);
    });
    it('drops queued worker-idle-only runs on handoff and keeps runs with other events', async () => {
        setupTask(); addRun({ status: 'running', taskId: 'task' });
        const idle = { type: 'work-session-idle', at: now.getTime(), data: { taskId: 'task', sessionId: 'worker' } };
        addRun({ taskId: 'task', eventPayload: { events: [idle, idle] } });
        addRun({ taskId: 'task', eventPayload: { events: [idle, event] } });
        await teammateTaskAgentUpdate('account', { ...auth, status: 'in_review', prUrl: 'https://github.com/owner/repo/pull/9' });
        expect(state.runs.map(run => run.status)).toEqual(['running', 'completed', 'queued']);
    });
    it.each(['paused', 'cancelled', 'done'])('rejects forbidden status changes from %s', async status => {
        setupTask(status); addRun({ status: 'running' });
        await expect(teammateTaskAgentUpdate('account', { ...auth, status: 'awaiting_input' })).rejects.toMatchObject({ code: 'task_inactive' });
    });
    it.each(['in_review', 'in_progress'] as const)('allows done to reopen as %s', async status => {
        setupTask('done'); addRun({ status: 'completed', finishedAt: now });
        expect(await teammateTaskAgentUpdate('account', { ...auth, status })).toMatchObject({ status });
    });
    it('rejects reopening when the issue already has another open task', async () => {
        setupTask('done'); state.tasks.push({ ...state.tasks[0], id: 'new-task', status: 'todo' }); addRun({ status: 'running' });
        await expect(teammateTaskAgentUpdate('account', { ...auth, status: 'in_progress' })).rejects.toMatchObject({ code: 'already_delegated' });
    });
    it('allows metadata on inactive tasks without changing their status', async () => {
        setupTask('paused'); addRun({ status: 'running' });
        expect(await teammateTaskAgentUpdate('account', { ...auth, summary: 'Stopped' })).toMatchObject({ status: 'paused', summary: 'Stopped' });
    });
    it('rejects non-task controllers and empty updates', async () => {
        addRun({ status: 'running' });
        await expect(teammateTaskAgentUpdate('account', { ...auth, summary: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
        await expect(teammateTaskAgentUpdate('account', auth)).rejects.toThrow();
    });
});

describe('issue comments', () => {
    it.each([false, true])('appends the signature once (already signed: %s)', async signed => {
        setupTask(); addRun({ status: 'running' }); state.committed = true;
        const signature = '\n\n— 🤖 Atlas (Happy Agent)';
        expect(await teammateTaskComment('account', { ...auth, body: 'Update' + (signed ? signature : '') })).toEqual({ url: 'https://github.com/owner/repo/issues/123#issuecomment-1' });
        expect(comment).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', issue_number: 123, body: 'Update' + signature });
    });
    it('reconciles a retry against the signed GitHub body without posting twice', async () => {
        setupTask(); addRun({ status: 'running' }); state.committed = true;
        const signed = 'Update\n\n— 🤖 Atlas (Happy Agent)';
        comment.mockImplementation(async () => {
            listComments.mockResolvedValue({ data: [{ body: signed, html_url: 'https://github.com/owner/repo/issues/123#issuecomment-1' }] });
            return { data: { html_url: 'https://github.com/owner/repo/issues/123#issuecomment-1' } };
        });
        const first = await teammateTaskComment('account', { ...auth, body: 'Update' });
        expect(await teammateTaskComment('account', { ...auth, body: signed })).toEqual(first);
        expect(comment).toHaveBeenCalledTimes(1);
    });
    it('serializes concurrent retries of the same signed comment', async () => {
        setupTask(); addRun({ status: 'running' }); state.committed = true;
        comment.mockImplementation(async ({ body }: any) => {
            listComments.mockResolvedValue({ data: [{ body, html_url: 'https://github.com/comment' }] });
            return { data: { html_url: 'https://github.com/comment' } };
        });
        const results = await Promise.all([teammateTaskComment('account', { ...auth, body: 'Update' }), teammateTaskComment('account', { ...auth, body: 'Update' })]);
        expect(results).toEqual([{ url: 'https://github.com/comment' }, { url: 'https://github.com/comment' }]); expect(comment).toHaveBeenCalledTimes(1);
    });
    it('checks subsequent pages for an existing signed comment', async () => {
        setupTask(); addRun({ status: 'running' }); state.committed = true;
        listComments.mockResolvedValueOnce({ data: Array.from({ length: 100 }, () => ({ body: 'other' })) }).mockResolvedValueOnce({ data: [{ body: 'Update\n\n— 🤖 Atlas (Happy Agent)', html_url: 'https://github.com/comment' }] });
        expect(await teammateTaskComment('account', { ...auth, body: 'Update' })).toEqual({ url: 'https://github.com/comment' });
        expect(comment).not.toHaveBeenCalled(); expect(listComments).toHaveBeenCalledTimes(2);
    });
    it('maps missing GitHub connection to github_not_connected', async () => {
        setupTask(); addRun({ status: 'running' }); github.mockRejectedValue(new GitHubNotConnectedError());
        await expect(teammateTaskComment('account', { ...auth, body: 'x' })).rejects.toMatchObject({ code: 'github_not_connected' });
    });
    it.each(['non-task', 'non-issue', 'malformed'])('rejects %s context', async mode => {
        const task = setupTask(); addRun({ status: 'running' });
        if (mode === 'non-task') state.threads[0].kind = 'dm';
        if (mode === 'non-issue') task.source = 'manual';
        if (mode === 'malformed') task.resourceId = 'oops';
        await expect(teammateTaskComment('account', { ...auth, body: 'x' })).rejects.toMatchObject({ code: 'invalid_request' }); expect(comment).not.toHaveBeenCalled();
    });
});

describe('worker session registration and shared authorization', () => {
    const register = { ...auth, sessionId: 'worker', role: 'worker' as const };
    beforeEach(() => { setupTask(); state.sessions.push({ id: 'worker', accountId: 'account' }); });
    it('upserts once and invalidates a negative cache after commit', async () => {
        addRun({ status: 'dispatching' }); expect(await teammateSessionLookup('worker')).toBeNull();
        await teammateSessionRegister('account', register); await teammateSessionRegister('account', register);
        expect(state.registrations).toHaveLength(1);
        expect(await teammateSessionLookup('worker')).toMatchObject({ taskId: 'task', role: 'worker', threadId: 'thread' });
    });
    it.each(['running', 'completed', 'failed', 'cancelled'])('allows %s recent registration', async status => {
        addRun({ status, finishedAt: now }); await teammateSessionRegister('account', register);
        expect(state.registrations[0]).toMatchObject({ sessionId: 'worker' });
    });
    it.each(['token', 'foreign-run', 'foreign-session', 'queued', 'non-task', 'expired', 'no-finishedAt'])('rejects %s registration', async mode => {
        const run = addRun({ status: 'running' });
        if (mode === 'token') run.dispatchToken = 'different';
        if (mode === 'foreign-run') state.teammates[0].accountId = 'foreign';
        if (mode === 'foreign-session') state.sessions[1].accountId = 'foreign';
        if (mode === 'queued') run.status = 'queued';
        if (mode === 'non-task') state.threads[0].kind = 'heartbeat';
        if (mode === 'expired') Object.assign(run, { status: 'completed', finishedAt: new Date(now.getTime() - 60 * 60_000) });
        if (mode === 'no-finishedAt') run.status = 'failed';
        await expect(teammateSessionRegister('account', register)).rejects.toMatchObject({ code: mode === 'token' ? 'invalid_token' : mode === 'foreign-run' || mode === 'foreign-session' ? 'not_found' : mode === 'expired' || mode === 'no-finishedAt' ? 'run_expired' : 'invalid_request' });
        expect(state.registrations).toHaveLength(0);
    });
    it('accepts a finished run one millisecond before the expiry boundary', async () => {
        addRun({ status: 'completed', finishedAt: new Date(now.getTime() - 60 * 60_000 + 1) });
        await teammateSessionRegister('account', register); expect(state.registrations).toHaveLength(1);
    });
    it('does not overwrite a controller registration', async () => {
        addRun({ status: 'running' }); state.registrations.push({ sessionId: 'worker', role: 'controller', taskId: 'task' });
        await expect(teammateSessionRegister('account', register)).rejects.toMatchObject({ code: 'invalid_request' });
    });
    it('invalidates no cache on failed commit', async () => {
        addRun({ status: 'running' }); expect(await teammateSessionLookup('worker')).toBeNull(); state.failCommit = true;
        await expect(teammateSessionRegister('account', register)).rejects.toThrow('commit failed');
        expect(await teammateSessionLookup('worker')).toBeNull();
    });
    it.each(['update', 'comment', 'message'] as const)('shared token/expiry auth applies to %s', async action => {
        setupDm(); const run = addRun({ status: 'completed', finishedAt: new Date(now.getTime() - 60 * 60_000) });
        const request = () => action === 'update' ? teammateTaskAgentUpdate('account', { ...auth, summary: 'x' }) : action === 'comment' ? teammateTaskComment('account', { ...auth, body: 'x' }) : daemonMessage();
        await expect(request()).rejects.toMatchObject({ code: 'run_expired' });
        run.dispatchToken = 'bad'; await expect(request()).rejects.toMatchObject({ code: 'invalid_token' });
    });
});

describe('owner stop/resume/cancel', () => {
    it('stop cancels queued and in-flight runs on every task thread and sends both RPCs only once', async () => {
        setupTask(); state.threads.push({ ...thread, id: 'second', kind: 'task', taskId: 'task' });
        addRun({ status: 'running', taskId: 'task' }); addRun({ status: 'dispatching', threadId: 'second', taskId: 'task' }); addRun({ taskId: 'task' }); addRun({ status: 'completed', taskId: 'task' });
        state.threads.push({ ...thread, id: 'unrelated' }); addRun({ threadId: 'unrelated' });
        expect(await teammateTaskStop('account', 'task')).toMatchObject({ status: 'paused' });
        await teammateTaskStop('account', 'task');
        expect(state.runs.map(r => r.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'completed', 'queued']);
        expect(rpc).toHaveBeenCalledTimes(3);
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-run-cancel', { runId: 'run_1', dispatchToken: 'secret', reason: 'cancelled_by_user' }, 30_000);
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-task-stop', { teammateId: 'mate', taskId: 'task', reason: 'paused' }, 30_000);
    });
    it('resume wakes manually and bypasses the cap once', async () => {
        setupTask('paused'); for (let i = 0; i < 60; i++) addRun({ status: 'completed', taskId: 'task' });
        expect(await teammateTaskResume('account', 'task')).toMatchObject({ status: 'in_progress' });
        await teammateTaskResume('account', 'task'); expect(state.runs).toHaveLength(61);
        expect(state.runs[60]).toMatchObject({ trigger: 'manual', eventPayload: { events: [{ type: 'manual', data: { taskId: 'task', note: 'Task resumed by owner after a pause; a stop by the owner also ended its workers. Check work_session_list / work_session_read, then continue (use continueFrom for unfinished workers).' } }] } });
        await teammateTaskWake('task', event); expect(state.tasks[0].status).toBe('paused');
    });
    it('stop can pause a completed task as specified', async () => {
        setupTask('done'); expect(await teammateTaskStop('account', 'task')).toMatchObject({ status: 'paused' });
    });
    it('stop cannot reopen done when the issue has another open task', async () => {
        setupTask('done'); state.tasks.push({ ...state.tasks[0], id: 'new-task', status: 'todo' });
        await expect(teammateTaskStop('account', 'task')).rejects.toMatchObject({ code: 'already_delegated' });
    });
    it('cancel is terminal; stop/resume/wake cannot revive it', async () => {
        setupTask(); addRun({ status: 'running', taskId: 'task' });
        expect(await teammateTaskCancel('account', 'task')).toMatchObject({ status: 'cancelled' });
        await teammateTaskCancel('account', 'task'); await teammateTaskResume('account', 'task'); await teammateTaskStop('account', 'task'); await teammateTaskWake('task', event);
        expect(state.tasks[0].status).toBe('cancelled'); expect(state.runs).toHaveLength(1);
        expect(rpc).toHaveBeenCalledWith('account', 'machine:teammate-task-stop', { teammateId: 'mate', taskId: 'task', reason: 'cancelled' }, 30_000);
    });
    it.each(['todo', 'in_progress', 'awaiting_input', 'in_review', 'done', 'cancelled'])('resume from %s is a no-op', async status => {
        setupTask(status); expect(await teammateTaskResume('account', 'task')).toMatchObject({ status }); expect(state.runs).toHaveLength(0);
    });
    it.each([teammateTaskStop, teammateTaskResume, teammateTaskCancel])('isolates owner actions', async action => {
        setupTask(); await expect(action('foreign', 'task')).rejects.toMatchObject({ code: 'not_found' }); expect(rpc).not.toHaveBeenCalled();
    });
    it('best-effort RPC failure does not roll back stop', async () => {
        setupTask(); addRun({ status: 'running' }); rpc.mockRejectedValue(new Error('offline'));
        expect(await teammateTaskStop('account', 'task')).toMatchObject({ status: 'paused' }); expect(state.runs[0].status).toBe('cancelled');
    });
    it('sends neither RPC nor events when stop fails to commit', async () => {
        setupTask(); addRun({ status: 'running' }); state.failCommit = true;
        await expect(teammateTaskStop('account', 'task')).rejects.toThrow('commit failed'); expect(rpc).not.toHaveBeenCalled(); expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });
});

describe('DM task routing', () => {
    it('user reply wakes the task thread and moves awaiting_input to in_progress exactly once', async () => {
        const task = setupTask('awaiting_input'); setupDm();
        const message = await userReply(); expect(task.status).toBe('in_progress');
        expect(state.runs).toMatchObject([{ threadId: 'thread', taskId: 'task', trigger: 'channel-message', eventPayload: { events: [{ data: { channelId: 'dm', messageId: message.id, seq: 1, taskId: 'task' } }] } }]);
        await userReply(); expect(state.runs[0].eventPayload.events).toHaveLength(1); expect(state.threads).toHaveLength(1);
    });
    it.each(['missing', 'foreign-account', 'foreign-teammate'])('rejects %s task with invalid_request before inserting a message', async mode => {
        const task = setupTask(); setupDm();
        if (mode === 'missing') state.tasks = [];
        if (mode === 'foreign-account') task.accountId = 'foreign';
        if (mode === 'foreign-teammate') task.teammateId = 'other';
        await expect(userReply()).rejects.toMatchObject({ code: 'invalid_request' }); expect(state.messages).toHaveLength(0); expect(state.runs).toHaveLength(0);
    });
    it.each(['paused', 'done', 'cancelled'])('reply leaves %s task inactive', async status => {
        const task = setupTask(status); setupDm(); await userReply(); expect(task.status).toBe(status); expect(state.runs).toHaveLength(0);
    });
    it('group taskId remains metadata and routes the mentioned group thread', async () => {
        setupTask('awaiting_input'); setupDm(); state.channel.kind = 'group';
        await channelMessageSend({ accountId: 'account', channelId: 'dm', sender: { type: 'user', accountId: 'account' }, req: { ...messageReq, mentions: ['mate'], taskId: 'task' } });
        expect(state.runs[0].threadId).not.toBe('thread'); expect(state.threads[1].kind).toBe('group'); expect(state.tasks[0].status).toBe('awaiting_input');
    });
    it('task controller posts to DM, forces taskId, and decision awaits input once', async () => {
        const task = setupTask(); setupDm(); addRun({ status: 'running', taskId: 'task' });
        const message = await daemonMessage({ kind: 'decision', taskId: 'foreign' });
        expect(message).toMatchObject({ channelId: 'dm', taskId: 'task', runId: 'run_1', kind: 'decision' }); expect(task.status).toBe('awaiting_input');
        await daemonMessage({ kind: 'decision', taskId: 'foreign' }); expect(dbMock.teammateTask.update).toHaveBeenCalledTimes(1); expect(state.messages).toHaveLength(1);
    });
    it('heartbeat reports go to the Agent DM without a task, and fail with no_dm when there is none', async () => {
        Object.assign(state.threads[0], { kind: 'heartbeat', taskId: null, channelId: null }); addRun({ status: 'running' });
        await expect(daemonMessage({ kind: 'report' })).rejects.toMatchObject({ code: 'no_dm' });
        setupDm();
        const sent = await daemonMessage({ kind: 'report' });
        expect(sent).toMatchObject({ channelId: 'dm', kind: 'report', taskId: null });
    });
    it('task reports with missing DM return no_dm', async () => {
        setupTask(); addRun({ status: 'running' }); await expect(daemonMessage()).rejects.toMatchObject({ code: 'no_dm' });
    });
    it.each(['paused', 'done', 'cancelled'])('late decisions cannot revive %s tasks', async status => {
        setupTask(status); setupDm(); addRun({ status: 'completed', finishedAt: now });
        await daemonMessage({ kind: 'decision' }); expect(state.tasks[0].status).toBe(status);
    });
});

describe('task dispatch payload', () => {
    it('contains the task DTO and the Agent DM including its wrapped key', async () => {
        setupTask(); setupDm(); const run = addRun({ taskId: 'task' });
        const action = await teammateRunPick(run.id, now);
        expect(action!.payload.task).toMatchObject({ id: 'task', status: 'in_progress', resourceId: 'owner/repo#123' });
        expect(action!.payload.thread).toMatchObject({ kind: 'task', channelId: null, taskId: 'task' });
        expect(action!.payload.channel).toMatchObject({ id: 'dm', kind: 'dm', teammateEncryptedDataKey: 'AwQ=' });
        expect(TeammateRunDispatchPayloadSchema.safeParse(action!.payload).success).toBe(true);
    });
    it('task without DM dispatches with channel=null', async () => {
        setupTask(); const run = addRun({ taskId: 'task' }); expect((await teammateRunPick(run.id))!.payload.channel).toBeNull();
    });
    it.each(['dm', 'group'])('missing %s channel fails unknown without retry', async kind => {
        Object.assign(state.threads[0], { kind, channelId: 'missing' }); const run = addRun();
        expect(await teammateRunPick(run.id)).toBeNull(); expect(run).toMatchObject({ status: 'failed', failureReason: 'unknown' }); expect(state.runs).toHaveLength(1);
    });
    it.each(['dm', 'group'])('missing %s member fails unknown', async kind => {
        setupDm(); state.channel.members = state.channel.members.slice(0, 1); Object.assign(state.threads[0], { kind, channelId: 'dm' }); const run = addRun();
        expect(await teammateRunPick(run.id)).toBeNull(); expect(run.status).toBe('failed');
    });
    it('dm with null channelId fails unknown', async () => {
        state.threads[0].kind = 'dm'; const run = addRun(); expect(await teammateRunPick(run.id)).toBeNull(); expect(run.failureReason).toBe('unknown');
    });
    it.each(['paused', 'done', 'cancelled'])('inactive %s tasks are never dispatched even if queued', async status => {
        setupTask(status); const run = addRun({ taskId: 'task' }); expect(await teammateRunPick(run.id)).toBeNull(); expect(run.status).toBe('queued');
    });
});

describe('task queries', () => {
    it('resource list is scoped and newest first; detail sessions oldest first and runs newest fifty', async () => {
        setupTask(); state.tasks.push({ ...state.tasks[0], id: 'new', createdAt: new Date(now.getTime() + 1) }, { ...state.tasks[0], id: 'foreign', accountId: 'foreign' });
        expect((await teammateTaskListByResource('account', 'owner/repo#123')).map(t => t.id)).toEqual(['new', 'task']);
        state.registrations.push({ sessionId: 'new', taskId: 'task', role: 'worker', createdAt: new Date(now.getTime() + 1) }, { sessionId: 'old', taskId: 'task', role: 'controller', createdAt: now });
        for (let i = 0; i < 55; i++) addRun({ taskId: 'task', queuedAt: new Date(now.getTime() + i) });
        const detail = await teammateTaskDetail('account', 'task'); expect(detail.sessions.map(s => s.sessionId)).toEqual(['old', 'new']); expect(detail.runs).toHaveLength(50);
        expect(detail.runs[0].id).toBe('run_55'); expect(detail.runs[49].id).toBe('run_6'); expect(detail.runs[0]).not.toHaveProperty('dispatchToken');
        await expect(teammateTaskDetail('foreign', 'task')).rejects.toMatchObject({ code: 'not_found' });
    });
});

async function makeApp() {
    vi.useRealTimers();
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    const app = fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.headers.authorization) return reply.code(401).send({ error: 'unauthorized' });
        request.userId = request.headers.authorization;
    });
    teammateTaskRoutes(app as Fastify); channelRoutes(app as Fastify); await app.ready(); return app;
}
const headers = { authorization: 'account' };
const routeCases = [
    ['POST', '/v1/teammate-tasks', delegate], ['GET', '/v1/teammate-tasks?resourceId=owner/repo%23123', undefined],
    ['GET', '/v1/teammate-tasks/task', undefined], ['POST', '/v1/teammate-tasks/task/stop', undefined],
    ['POST', '/v1/teammate-tasks/task/resume', undefined], ['POST', '/v1/teammate-tasks/task/cancel', undefined],
    ['POST', '/v1/teammate-task-updates', { ...auth, summary: 'Ready' }], ['POST', '/v1/teammate-task-comments', { ...auth, body: 'Ready' }],
    ['POST', '/v1/teammate-sessions', { ...auth, sessionId: 'worker', role: 'worker' }],
] as const;

describe('task routes', () => {
    it.each(routeCases)('authenticates %s %s', async (method, url, payload) => {
        const app = await makeApp(); const result = await app.inject({ method, url, payload }); expect(result.statusCode).toBe(401); await app.close();
    });
    it('serves delegate/list/detail/stop/resume/cancel and enforces already_delegated', async () => {
        const app = await makeApp();
        const response = await app.inject({ method: 'POST', url: '/v1/teammate-tasks', headers, payload: delegate }); expect(response.statusCode).toBe(200); const id = response.json().task.id;
        state.teammates.push({ ...profile, id: 'other' });
        const conflict = await app.inject({ method: 'POST', url: '/v1/teammate-tasks', headers, payload: { ...delegate, teammateId: 'other' } }); expect(conflict.statusCode).toBe(409); expect(conflict.json()).toEqual({ error: 'already_delegated' });
        const list = await app.inject({ method: 'GET', url: '/v1/teammate-tasks?resourceId=owner/repo%23123', headers }); expect(list.statusCode).toBe(200); expect(list.json().tasks).toHaveLength(1);
        const detail = await app.inject({ method: 'GET', url: `/v1/teammate-tasks/${id}`, headers }); expect(detail.statusCode).toBe(200); expect(detail.json().runs).toHaveLength(1);
        for (const [action, status] of [['stop', 'paused'], ['resume', 'in_progress'], ['cancel', 'cancelled']]) {
            const result = await app.inject({ method: 'POST', url: `/v1/teammate-tasks/${id}/${action}`, headers }); expect(result.statusCode).toBe(200); expect(result.json().task.status).toBe(status);
        }
        await app.close();
    });
    it('serves daemon updates/comments/registration', async () => {
        setupTask(); addRun({ status: 'running' }); state.sessions.push({ id: 'worker', accountId: 'account' }); state.committed = true;
        const app = await makeApp();
        for (const [, url, payload] of routeCases.slice(6)) { const result = await app.inject({ method: 'POST', url, payload, headers }); expect(result.statusCode).toBe(200); }
        await app.close();
    });
    it('maps validation/not_found/task_inactive/invalid_token/run_expired/GitHub/no_dm errors', async () => {
        const task = setupTask('paused'); const run = addRun({ status: 'running' }); const app = await makeApp();
        const inject = (url: string, payload: any) => app.inject({ method: 'POST', url, payload, headers });
        expect((await inject('/v1/teammate-tasks', { ...delegate, resourceId: 'bad' })).statusCode).toBe(400);
        expect((await inject('/v1/teammate-task-updates', auth)).statusCode).toBe(400);
        expect((await inject('/v1/teammate-tasks/missing/stop', undefined)).statusCode).toBe(404);
        const inactive = await inject('/v1/teammate-task-updates', { ...auth, status: 'done' }); expect(inactive.statusCode).toBe(409); expect(inactive.json().error).toBe('task_inactive');
        expect((await inject('/v1/teammate-task-updates', { ...auth, dispatchToken: 'bad', summary: 'x' })).statusCode).toBe(403);
        Object.assign(run, { status: 'completed', finishedAt: new Date(now.getTime() - 60 * 60_000) });
        const expired = await inject('/v1/teammate-sessions', { ...auth, sessionId: 'session', role: 'worker' }); expect(expired.statusCode).toBe(403); expect(expired.json().error).toBe('run_expired');
        run.finishedAt = now; github.mockRejectedValue(new GitHubNotConnectedError());
        const notConnected = await inject('/v1/teammate-task-comments', { ...auth, body: 'x' }); expect(notConnected.statusCode).toBe(409); expect(notConnected.json().error).toBe('github_not_connected');
        const noDm = await inject('/v1/teammate-channel-messages', { ...auth, ...messageReq }); expect(noDm.statusCode).toBe(409); expect(noDm.json().error).toBe('no_dm');
        setupDm(); task.accountId = 'foreign'; const invalidTask = await inject('/v1/channels/dm/messages', { ...messageReq, taskId: 'task' }); expect(invalidTask.statusCode).toBe(400); expect(invalidTask.json().error).toBe('invalid_request');
        await app.close();
    });
});
