import { beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Fastify } from '@/app/api/types';

const { run, dbMock, authorize, octokit, delegate, message, notify, tx, GitHubNotConnectedError } = vi.hoisted(() => {
    const run = { value: null as any };
    const dbMock = {
        teammate: { findFirst: vi.fn() },
        teammateTask: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    };
    const tx = {
        channel: { findFirst: vi.fn() },
        channelMessage: { findUnique: vi.fn() },
    };
    return { run, dbMock, authorize: vi.fn(), octokit: vi.fn(), delegate: vi.fn(), message: vi.fn(), notify: vi.fn(), tx, GitHubNotConnectedError: class GitHubNotConnectedError extends Error {} };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({ getPublicUrl: vi.fn() }));
vi.mock('@/storage/inTx', () => ({ inTx: (fn: any) => fn(tx) }));
vi.mock('@/app/github/githubApi', () => ({ getUserOctokit: octokit, GitHubNotConnectedError }));
vi.mock('@/app/channel/channelSystemMessage', () => ({ channelSystemMessage: message }));
vi.mock('./teammateRunAuthorize', () => ({ teammateRunAuthorize: authorize }));
vi.mock('./teammateTaskDelegate', () => ({ teammateTaskDelegate: delegate }));
vi.mock('./teammateNotify', () => ({ teammateNotify: notify }));

import { teammateTaskCreate } from './teammateTaskCreate';
import { teammateTaskRoutes } from '@/app/api/routes/teammateTaskRoutes';

const req = { runId: 'run', dispatchToken: 'token', requestId: 'tc:run:1', repo: 'owner/repo', issueNumber: 4 };
const creator = { id: 'creator', accountId: 'account', name: 'Atlas', handle: 'atlas', status: 'active', canSelfAssign: true, repos: ['OWNER/REPO'] };
const assignee = { id: 'assignee', accountId: 'account', name: 'Builder', handle: 'builder', status: 'active', machineId: 'machine' };
const issue = { number: 4, title: 'Fix issue', html_url: 'https://github.com/owner/repo/issues/4', state: 'open' };
const task = { id: 'task', teammateId: 'assignee', createdByTeammateId: 'creator', createdByThreadId: 'creator-thread', source: 'github-issue', resourceId: 'owner/repo#4', title: 'Fix issue', url: issue.html_url, status: 'todo', summary: null, prUrl: null, createdAt: Date.parse('2026-10-09T12:00:00Z'), updatedAt: Date.parse('2026-10-09T12:00:00Z') };
const api = {
    rest: {
        issues: { get: vi.fn(), listForRepo: vi.fn(), create: vi.fn() },
        users: { getAuthenticated: vi.fn() },
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    run.value = { teammate: { ...creator }, threadId: 'creator-thread' };
    authorize.mockImplementation(async () => run.value);
    dbMock.teammate.findFirst.mockResolvedValue({ ...assignee });
    dbMock.teammateTask.findFirst.mockResolvedValue(null);
    dbMock.teammateTask.count.mockResolvedValue(0);
    tx.channel.findFirst.mockResolvedValue({ id: 'dm' });
    tx.channelMessage.findUnique.mockResolvedValue(null);
    octokit.mockResolvedValue(api);
    api.rest.issues.get.mockResolvedValue({ data: issue });
    api.rest.issues.listForRepo.mockResolvedValue({ data: [] });
    api.rest.issues.create.mockResolvedValue({ data: issue });
    api.rest.users.getAuthenticated.mockResolvedValue({ data: { login: 'owner' } });
    delegate.mockResolvedValue(task);
});

describe('agent task creation', () => {
    it('rejects disabled self assignment, disallowed repos, and missing assignees', async () => {
        run.value.teammate.canSelfAssign = false;
        await expect(teammateTaskCreate('account', req)).rejects.toMatchObject({ code: 'self_assign_disabled' });
        run.value.teammate.canSelfAssign = true; run.value.teammate.repos = [];
        await expect(teammateTaskCreate('account', req)).rejects.toMatchObject({ code: 'repo_not_allowed' });
        run.value.teammate.repos = ['owner/repo']; dbMock.teammate.findFirst.mockResolvedValue(null);
        await expect(teammateTaskCreate('account', { ...req, assignee: 'Nobody' })).rejects.toMatchObject({ code: 'not_found' });
        expect(octokit).not.toHaveBeenCalled();
    });

    it('delegates an existing open issue and records its creator in the assignee DM', async () => {
        const result = await teammateTaskCreate('account', { ...req, assignee: 'builder' });
        expect(result).toEqual({ task, issueUrl: issue.html_url, created: false });
        expect(delegate).toHaveBeenCalledWith('account', expect.objectContaining({ teammateId: 'assignee', resourceId: 'owner/repo#4' }), 'creator', 'creator-thread');
        expect(message).toHaveBeenCalledWith('dm', 'task_self_assigned', expect.objectContaining({ byTeammateId: 'creator', byName: 'Atlas' }), tx, 'system:task_self_assigned:task');
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('rejects a closed issue, foreign delegation, missing GitHub, and the daily limit, while accepting PRs', async () => {
        api.rest.issues.get.mockResolvedValueOnce({ data: { ...issue, state: 'closed' } });
        await expect(teammateTaskCreate('account', req)).rejects.toMatchObject({ code: 'issue_not_found' });
        api.rest.issues.get.mockResolvedValueOnce({ data: { ...issue, pull_request: {} } });
        delegate.mockResolvedValueOnce({ ...task, prUrl: issue.html_url });
        await expect(teammateTaskCreate('account', req)).resolves.toMatchObject({ task: { prUrl: issue.html_url } });
        expect(delegate).toHaveBeenLastCalledWith('account', expect.objectContaining({ prUrl: issue.html_url }), 'creator', 'creator-thread');
        dbMock.teammateTask.findFirst.mockResolvedValueOnce({ ...task, teammateId: 'other' });
        await expect(teammateTaskCreate('account', req)).rejects.toMatchObject({ code: 'already_delegated' });
        octokit.mockRejectedValueOnce(new GitHubNotConnectedError('no token'));
        await expect(teammateTaskCreate('account', req)).rejects.toMatchObject({ code: 'github_not_connected' });
        dbMock.teammateTask.count.mockResolvedValue(20);
        await expect(teammateTaskCreate('account', req)).resolves.toMatchObject({ created: false });
        await expect(teammateTaskCreate('account', { runId: 'run', dispatchToken: 'token', requestId: 'tc:run:limit', repo: 'owner/repo', title: 'New', body: 'x' })).rejects.toMatchObject({ code: 'task_create_limit' });
        expect(dbMock.teammateTask.count).toHaveBeenLastCalledWith({ where: expect.objectContaining({ createdIssue: true }) });
        expect(notify).toHaveBeenCalledWith(tx, expect.anything(), 'Agent task limit reached', expect.any(String), expect.objectContaining({ code: 'task_create_limit' }));
    });

    it('creates a signed issue with marker, then reuses the marker without creating twice', async () => {
        const input = { runId: 'run', dispatchToken: 'token', requestId: 'tc:run:2', repo: 'owner/repo', title: 'Fix issue', body: 'Details', assignee: 'Builder' };
        const first = await teammateTaskCreate('account', input);
        expect(first.created).toBe(true);
        expect(dbMock.teammateTask.update).toHaveBeenCalledWith({ where: { id: task.id }, data: { createdIssue: true } });
        expect(api.rest.issues.create).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('<!-- happy-agent-task:tc:run:2 -->') }));
        api.rest.issues.listForRepo.mockResolvedValue({ data: [{ ...issue, body: '<!-- happy-agent-task:tc:run:2 -->' }] });
        dbMock.teammateTask.findFirst.mockResolvedValue(task);
        tx.channelMessage.findUnique.mockResolvedValue({ id: 'message' });
        const second = await teammateTaskCreate('account', input);
        expect(second.created).toBe(false);
        expect(api.rest.issues.create).toHaveBeenCalledTimes(1);
        expect(message).toHaveBeenCalledTimes(1);
    });

    it('validates a designated reviewer and stores it on a reused task', async () => {
        // "@Code Reviewer" is a name; "@builder" only matches the legacy handle after the name lookup misses.
        dbMock.teammate.findFirst.mockImplementation(async ({ where }: any) => where.name?.equals === 'Code Reviewer' ? { id: 'reviewer', accountId: 'account', status: 'active' }
            : where.handle === 'builder' ? { ...assignee } : null);
        const result = await teammateTaskCreate('account', { ...req, assignee: '@builder', reviewer: '@Code Reviewer' });
        expect(dbMock.teammate.findFirst).toHaveBeenCalledWith({ where: { accountId: 'account', status: 'active', name: { equals: 'builder', mode: 'insensitive' } } });
        expect(dbMock.teammate.findFirst).toHaveBeenCalledWith({ where: { accountId: 'account', status: 'active', handle: 'builder' } });
        expect(result.task).toMatchObject({ reviewerTeammateId: 'reviewer' });
        expect(dbMock.teammateTask.update).toHaveBeenCalledWith({ where: { id: task.id }, data: { reviewerTeammateId: 'reviewer' } });

        dbMock.teammate.findFirst.mockResolvedValue(null);
        await expect(teammateTaskCreate('account', { ...req, reviewer: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
        dbMock.teammate.findFirst.mockResolvedValue({ ...creator });
        await expect(teammateTaskCreate('account', { ...req, reviewer: 'Atlas' })).rejects.toMatchObject({ code: 'invalid_request' });
    });
});

describe('agent task route', () => {
    it('authenticates, validates, and returns the task creation response', async () => {
        const app = fastify().withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
            if (request.headers.authorization !== 'Bearer account') return reply.code(401).send({ error: 'unauthorized' });
            (request as FastifyRequest & { userId: string }).userId = 'account';
        });
        teammateTaskRoutes(app as unknown as Fastify); await app.ready();
        try {
            expect((await app.inject({ method: 'POST', url: '/v1/teammate-agent-tasks', payload: req })).statusCode).toBe(401);
            const result = await app.inject({ method: 'POST', url: '/v1/teammate-agent-tasks', headers: { authorization: 'Bearer account' }, payload: req });
            expect(result.statusCode).toBe(200);
            expect(result.json()).toMatchObject({ issueUrl: issue.html_url, created: false });
            const invalid = await app.inject({ method: 'POST', url: '/v1/teammate-agent-tasks', headers: { authorization: 'Bearer account' }, payload: { ...req, title: 'also title' } });
            expect(invalid.statusCode).toBe(400);
        } finally { await app.close(); }
    });
});
