import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type Teammate as TeammateRow } from '@prisma/client';
import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { TEAMMATE_CONTEXT_BUDGET_MIN, TeammateCreateRequestSchema } from 'happy-wire';
import type { Fastify } from '@/app/api/types';

const { dbMock, state } = vi.hoisted(() => {
    const state = { committed: false, failCommit: false };
    const dbMock = {
        teammate: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
        machine: { findFirst: vi.fn() },
        account: { update: vi.fn() },
        teammateRun: { findMany: vi.fn() },
        teammateTask: { findMany: vi.fn() },
        teammateSession: { findMany: vi.fn() },
        usageReport: { findMany: vi.fn() },
        $transaction: vi.fn(),
    };
    return { dbMock, state };
});
vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({ getPublicUrl: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import { eventRouter } from '@/app/events/eventRouter';
import { teammateCreate } from './teammateCreate';
import { teammateUpdate } from './teammateUpdate';
import { teammateArchive } from './teammateArchive';
import { teammateSpendGet } from './teammateSpend';
import { TeammateError } from './teammateError';
import {
    toTeammateDto, toTeammateRunDto, toTeammateTaskDto,
    teammateList, teammateGet, teammateRunList, teammateTaskList,
} from './teammateQueries';
import { teammateRoutes } from '@/app/api/routes/teammateRoutes';

const createdAt = new Date('2026-09-30T23:59:59.999Z');
const updatedAt = new Date('2026-10-08T08:00:00.000Z');
const profile: TeammateRow = {
    id: 'mate_1', accountId: 'account_1', handle: 'atlas', name: 'Atlas', avatar: null,
    role: 'Backend engineer', skills: ['typescript'], repos: ['owner/repo'], instructions: 'Ship small changes',
    machineId: 'machine_1', controllerProvider: 'claude', controllerModel: null, controllerPermissionMode: 'default', controllerProfileId: null, controllerEnv: null, workerProvider: 'claude', model: null, workerPermissionMode: 'default', workerProfileId: null, workerEnv: null,
    maxConcurrentRuns: 3, monthlyBudgetUsd: 100, heartbeatIntervalMin: null, activeHours: null, timezone: null,
    dreamingHour: null, canSelfAssign: false, contextBudgetTokens: null, contextAutoRollover: true, status: 'active', createdAt, updatedAt,
};
const createInput = { handle: 'atlas', name: 'Atlas', machineId: 'machine_1' };
const run = {
    id: 'run_1', teammateId: 'mate_1', threadId: 'thread_1', thread: { kind: 'task' },
    trigger: 'manual', status: 'queued', attempt: 1, failureReason: null, sessionId: null,
    taskId: 'task_1', costUsd: null, inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, outputTokens: null,
    queuedAt: createdAt, startedAt: updatedAt, finishedAt: null,
    dispatchToken: 'secret', eventPayload: [],
};
const task = {
    id: 'task_1', teammateId: 'mate_1', accountId: 'account_1', source: 'chat', resourceId: null, createdByTeammateId: null, createdByThreadId: null, createdIssue: false,
    title: 'Investigate', url: null, status: 'todo', summary: null, prUrl: null, createdAt, updatedAt,
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    state.committed = false;
    state.failCommit = false;
    dbMock.$transaction.mockImplementation(async (fn) => {
        state.committed = false;
        const result = await fn(dbMock);
        if (state.failCommit) throw new Error('commit failed');
        state.committed = true;
        return result;
    });
    dbMock.machine.findFirst.mockResolvedValue({ id: 'machine_1' });
    // A lookup by name is the uniqueness check; no other Agent holds the name unless a test says so.
    dbMock.teammate.findFirst.mockImplementation(async ({ where }) => where?.name ? null : { ...profile });
    dbMock.teammate.findMany.mockResolvedValue([profile]);
    dbMock.teammate.create.mockResolvedValue({ ...profile });
    dbMock.teammate.update.mockImplementation(async ({ data }) => ({ ...profile, ...data }));
    dbMock.account.update.mockResolvedValue({ seq: 42 });
    dbMock.teammateRun.findMany.mockResolvedValue([run]);
    dbMock.teammateTask.findMany.mockResolvedValue([task]);
    dbMock.teammateSession.findMany.mockResolvedValue([]);
    dbMock.usageReport.findMany.mockResolvedValue([]);
    vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {
        expect(state.committed).toBe(true);
        return { total: 1, sessionScoped: 0 };
    });
});

describe('teammate create', () => {
    it('creates only a profile with wire defaults and emits an account update after commit', async () => {
        const teammate = await teammateCreate('account_1', createInput);
        expect(teammate.id).toBe('mate_1');
        expect(teammate.contextAutoRollover).toBe(true);
        expect(dbMock.machine.findFirst).toHaveBeenCalledWith({ where: { id: 'machine_1', accountId: 'account_1' }, select: { id: true } });
        expect(dbMock.teammate.create).toHaveBeenCalledWith({ data: {
            ...TeammateCreateRequestSchema.parse(createInput), handle: 'atlas-2', accountId: 'account_1',
            avatar: Prisma.DbNull, activeHours: Prisma.DbNull,
        } });
        expect(dbMock.account.update).toHaveBeenCalledWith({ where: { id: 'account_1' }, data: { seq: { increment: 1 } }, select: { seq: true } });
        expect(eventRouter.emitUpdate).toHaveBeenCalledWith({
            userId: 'account_1', recipientFilter: { type: 'user-scoped-only' },
            payload: expect.objectContaining({ seq: 42, body: { t: 'teammate-updated', teammate } }),
        });
    });

    it('creates, updates, and clears a context budget while rejecting values below the minimum', async () => {
        const budget = TEAMMATE_CONTEXT_BUDGET_MIN;
        dbMock.teammate.create.mockResolvedValueOnce({ ...profile, contextBudgetTokens: budget });
        const created = await teammateCreate('account_1', { ...createInput, contextBudgetTokens: budget });
        expect(dbMock.teammate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ contextBudgetTokens: budget }) });
        expect(created.contextBudgetTokens).toBe(budget);

        const updated = await teammateUpdate('account_1', 'mate_1', { contextBudgetTokens: budget + 1000 });
        expect(dbMock.teammate.update).toHaveBeenLastCalledWith({
            where: { id: 'mate_1', accountId: 'account_1' }, data: { contextBudgetTokens: budget + 1000 },
        });
        expect(updated.contextBudgetTokens).toBe(budget + 1000);

        const cleared = await teammateUpdate('account_1', 'mate_1', { contextBudgetTokens: null });
        expect(dbMock.teammate.update).toHaveBeenLastCalledWith({
            where: { id: 'mate_1', accountId: 'account_1' }, data: { contextBudgetTokens: null },
        });
        expect(cleared.contextBudgetTokens).toBeNull();
        expect(TeammateCreateRequestSchema.safeParse({ ...createInput, contextBudgetTokens: budget - 1 }).success).toBe(false);
    });

    it('updates automatic context rollover off and back on', async () => {
        const disabled = await teammateUpdate('account_1', 'mate_1', { contextAutoRollover: false });
        expect(dbMock.teammate.update).toHaveBeenLastCalledWith({
            where: { id: 'mate_1', accountId: 'account_1' }, data: { contextAutoRollover: false },
        });
        expect(disabled.contextAutoRollover).toBe(false);

        const enabled = await teammateUpdate('account_1', 'mate_1', { contextAutoRollover: true });
        expect(dbMock.teammate.update).toHaveBeenLastCalledWith({
            where: { id: 'mate_1', accountId: 'account_1' }, data: { contextAutoRollover: true },
        });
        expect(enabled.contextAutoRollover).toBe(true);
    });

    it('rejects a name another active Agent already uses, ignoring case', async () => {
        dbMock.teammate.findFirst.mockImplementation(async ({ where }) => ({ ...profile, name: where?.name?.equals ?? profile.name }));
        await expect(teammateCreate('account_1', { ...createInput, name: 'ATLAS' })).rejects.toMatchObject({ code: 'name_taken', name: 'TeammateError' });
        expect(dbMock.teammate.findFirst).toHaveBeenCalledWith({
            where: { accountId: 'account_1', name: { equals: 'ATLAS', mode: 'insensitive' }, status: { not: 'archived' } }, select: { id: true },
        });
        expect(dbMock.teammate.create).not.toHaveBeenCalled();
        expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });

    it.each([
        [{ name: 'Atlas' }, [], 'atlas'],
        [{ name: '小明', handle: 'reviewer' }, [{ handle: 'reviewer' }, { handle: 'reviewer-2' }], 'reviewer-3'],
        [{ name: '小明' }, [], 'agent'],
        [{ name: 'Café Bot' }, [], 'cafe-bot'],
    ])('allocates a free internal handle for %j', async (input, taken, handle) => {
        dbMock.teammate.findMany.mockResolvedValueOnce(taken);
        await teammateCreate('account_1', { machineId: 'machine_1', ...input });
        expect(dbMock.teammate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ handle }) });
    });

    it('does not mislabel an unrelated unique violation', async () => {
        const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002', clientVersion: '6.19.3', meta: { target: ['id'] },
        });
        dbMock.teammate.create.mockRejectedValueOnce(error);
        await expect(teammateCreate('account_1', createInput)).rejects.toBe(error);
    });

    it('rejects a missing or foreign machine without creating a profile', async () => {
        dbMock.machine.findFirst.mockResolvedValueOnce(null);
        await expect(teammateCreate('account_1', createInput)).rejects.toMatchObject({ code: 'machine_not_found' });
        expect(dbMock.teammate.create).not.toHaveBeenCalled();
        expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });

    it('rejects a permission mode that does not belong to the runtime provider', async () => {
        await expect(teammateCreate('account_1', { ...createInput, controllerProvider: 'codex', controllerPermissionMode: 'bypassPermissions' }))
            .rejects.toMatchObject({ code: 'invalid_request' });
        expect(dbMock.teammate.create).not.toHaveBeenCalled();
    });

    it('does not emit when the transaction fails at commit', async () => {
        state.failCommit = true;
        await expect(teammateCreate('account_1', createInput)).rejects.toThrow('commit failed');
        expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });
});

describe('teammate update and archive', () => {
    it('rejects editing an archived teammate', async () => {
        dbMock.teammate.findFirst.mockResolvedValueOnce({ ...profile, status: 'archived' });
        await expect(teammateUpdate('account_1', 'mate_1', { name: 'New' })).rejects.toMatchObject({ code: 'archived' });
        expect(dbMock.teammate.update).not.toHaveBeenCalled();
        expect(eventRouter.emitUpdate).not.toHaveBeenCalled();
    });

    it('updates only supplied fields without applying creation defaults', async () => {
        const result = await teammateUpdate('account_1', 'mate_1', { name: 'New' });
        expect(dbMock.teammate.update).toHaveBeenCalledWith({ where: { id: 'mate_1', accountId: 'account_1' }, data: { name: 'New' } });
        expect(result).toMatchObject({ name: 'New', role: profile.role, skills: profile.skills, monthlyBudgetUsd: 100 });
        expect(dbMock.machine.findFirst).not.toHaveBeenCalled();
        expect(eventRouter.emitUpdate).toHaveBeenCalledOnce();
    });

    it('validates a provider switch against the stored permission mode', async () => {
        dbMock.teammate.findFirst.mockResolvedValueOnce({ ...profile, controllerPermissionMode: 'bypassPermissions' });
        await expect(teammateUpdate('account_1', 'mate_1', { controllerProvider: 'codex' })).rejects.toMatchObject({ code: 'invalid_request' });
        await teammateUpdate('account_1', 'mate_1', { controllerProvider: 'codex', controllerPermissionMode: 'full-auto' });
        expect(dbMock.teammate.update).toHaveBeenCalledWith({
            where: { id: 'mate_1', accountId: 'account_1' }, data: { controllerProvider: 'codex', controllerPermissionMode: 'full-auto' },
        });
    });

    it('can clear nullable JSON fields explicitly', async () => {
        dbMock.teammate.update.mockResolvedValueOnce(profile);
        await teammateUpdate('account_1', 'mate_1', { avatar: null, activeHours: null });
        expect(dbMock.teammate.update).toHaveBeenCalledWith({
            where: { id: 'mate_1', accountId: 'account_1' }, data: { avatar: Prisma.DbNull, activeHours: Prisma.DbNull },
        });
    });

    it('validates ownership when changing the machine', async () => {
        dbMock.machine.findFirst.mockResolvedValueOnce(null);
        await expect(teammateUpdate('account_1', 'mate_1', { machineId: 'foreign' })).rejects.toMatchObject({ code: 'machine_not_found' });
        expect(dbMock.machine.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', accountId: 'account_1' }, select: { id: true } });
        expect(dbMock.teammate.update).not.toHaveBeenCalled();
    });

    it('archives idempotently, retaining the row and returning its previous timestamp on repeat', async () => {
        const first = await teammateArchive('account_1', 'mate_1');
        dbMock.teammate.findFirst.mockResolvedValueOnce({ ...profile, status: 'archived' });
        const second = await teammateArchive('account_1', 'mate_1');
        expect(first).toEqual(second);
        expect(first.status).toBe('archived');
        expect(dbMock.teammate.update).toHaveBeenCalledOnce();
        expect(eventRouter.emitUpdate).toHaveBeenCalledTimes(2);
    });

    it('returns not_found for missing or foreign profiles in both mutations', async () => {
        dbMock.teammate.findFirst.mockResolvedValue(null);
        await expect(teammateUpdate('account_1', 'foreign', { name: 'New' })).rejects.toBeInstanceOf(TeammateError);
        await expect(teammateArchive('account_1', 'foreign')).rejects.toMatchObject({ code: 'not_found' });
        expect(dbMock.teammate.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', accountId: 'account_1' } });
    });
});

describe('teammate DTOs and queries', () => {
    it('converts dates to epoch ms, validates optional JSON and removes internal fields', () => {
        expect(toTeammateDto({ ...profile, avatar: { emoji: '🤖', color: '#abc' } })).toMatchObject({
            createdAt: createdAt.getTime(), updatedAt: updatedAt.getTime(), avatar: { emoji: '🤖', color: '#abc' },
        });
        expect(toTeammateDto(profile)).not.toHaveProperty('accountId');
        expect(toTeammateDto({ ...profile, avatar: { imageUrl: 'invalid' }, activeHours: { start: 42 } })).toMatchObject({ avatar: null, activeHours: null });
    });

    it('preserves valid active hours and run task/thread context with nullable timestamps', () => {
        const activeHours = { start: '09:00', end: '18:00', timezone: 'Asia/Shanghai', days: [1, 2] };
        expect(toTeammateDto({ ...profile, activeHours }).activeHours).toEqual(activeHours);
        expect(toTeammateRunDto(run)).toMatchObject({
            threadKind: 'task', taskId: 'task_1', queuedAt: createdAt.getTime(), startedAt: updatedAt.getTime(), finishedAt: null,
        });
        expect(toTeammateRunDto(run)).not.toHaveProperty('dispatchToken');
        expect(toTeammateTaskDto(task)).toMatchObject({ createdAt: createdAt.getTime(), updatedAt: updatedAt.getTime() });
    });

    it('excludes archived profiles by default, with an explicit option to include them', async () => {
        await teammateList('account_1');
        expect(dbMock.teammate.findMany).toHaveBeenLastCalledWith({ where: { accountId: 'account_1', status: { not: 'archived' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        await teammateList('account_1', true);
        expect(dbMock.teammate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { accountId: 'account_1' } }));
    });

    it('scopes reads to the account and returns null without querying foreign run/task histories', async () => {
        dbMock.teammate.findFirst.mockResolvedValue(null);
        expect(await teammateGet('account_1', 'foreign')).toBeNull();
        expect(await teammateRunList('account_1', 'foreign')).toBeNull();
        expect(await teammateTaskList('account_1', 'foreign')).toBeNull();
        expect(dbMock.teammateRun.findMany).not.toHaveBeenCalled();
        expect(dbMock.teammateTask.findMany).not.toHaveBeenCalled();
    });

    it('uses an exclusive run cursor, bounded limit and included thread relation', async () => {
        await teammateRunList('account_1', 'mate_1', 200, updatedAt.getTime());
        expect(dbMock.teammateRun.findMany).toHaveBeenCalledWith({
            where: { teammateId: 'mate_1', teammate: { accountId: 'account_1' }, queuedAt: { lt: updatedAt } },
            include: { thread: { select: { kind: true } } }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }], take: 200,
        });
    });

    it('excludes only done and cancelled from active tasks and sorts by updatedAt', async () => {
        await teammateTaskList('account_1', 'mate_1', 'active');
        expect(dbMock.teammateTask.findMany).toHaveBeenCalledWith({
            where: { accountId: 'account_1', teammateId: 'mate_1', status: { notIn: ['done', 'cancelled'] } },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        });
    });

});

describe('run token DTO', () => {
    it('keeps unused runs null and maps stored counters', () => {
        expect(toTeammateRunDto({ ...run, inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, outputTokens: null } as any).tokens).toBeNull();
        expect(toTeammateRunDto({ ...run, inputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, outputTokens: 5 } as any).tokens).toEqual({ input: 2, cacheRead: 3, cacheWrite: 4, output: 5 });
    });
});

describe('teammate monthly spend', () => {
    it('sums cost.total from the inclusive UTC month boundary, excluding other sessions and accounts', async () => {
        dbMock.teammateSession.findMany.mockResolvedValue([{ sessionId: 'controller_1' }, { sessionId: 'worker_1' }]);
        const reports = [
            { accountId: 'account_1', sessionId: 'controller_1', createdAt, data: { cost: { total: 100 } } },
            { accountId: 'account_1', sessionId: 'controller_1', createdAt: new Date('2026-10-01T00:00:00Z'), data: { cost: { total: 2, input: 1, output: 1 } } },
            { accountId: 'account_1', sessionId: 'worker_1', createdAt: updatedAt, data: { cost: { total: 3 } } },
            { accountId: 'account_1', sessionId: 'other_teammate', createdAt: updatedAt, data: { cost: { total: 50 } } },
            { accountId: 'account_2', sessionId: 'controller_1', createdAt: updatedAt, data: { cost: { total: 1000 } } },
        ];
        dbMock.usageReport.findMany.mockImplementation(async ({ where }) => reports.filter((r) =>
            r.accountId === where.accountId && where.sessionId.in.includes(r.sessionId) && r.createdAt >= where.createdAt.gte));
        // This local date is in September; its UTC date is already October.
        const spend = await teammateSpendGet('account_1', 'mate_1', new Date('2026-09-30T23:30:00-02:00'));
        expect(spend).toEqual({ teammateId: 'mate_1', monthStart: Date.UTC(2026, 9, 1), spentUsd: 5, budgetUsd: 100, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } });
        expect(dbMock.teammateSession.findMany).toHaveBeenCalledWith({ where: { teammateId: 'mate_1', teammate: { accountId: 'account_1' } }, select: { sessionId: true } });
        expect(dbMock.usageReport.findMany).toHaveBeenCalledWith({
            where: { accountId: 'account_1', sessionId: { in: ['controller_1', 'worker_1'] }, createdAt: { gte: new Date('2026-10-01T00:00:00Z') } },
            select: { data: true },
        });
    });

    it('returns zero for no sessions and preserves a null budget across the year boundary', async () => {
        dbMock.teammate.findFirst.mockResolvedValueOnce({ monthlyBudgetUsd: null });
        expect(await teammateSpendGet('account_1', 'mate_1', new Date('2027-01-01T00:00:00Z'))).toEqual({
            teammateId: 'mate_1', monthStart: Date.UTC(2027, 0, 1), spentUsd: 0, budgetUsd: null, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        });
        expect(dbMock.usageReport.findMany).not.toHaveBeenCalled();
    });

    it('ignores invalid cost totals rather than poisoning the sum', async () => {
        dbMock.teammateSession.findMany.mockResolvedValueOnce([{ sessionId: 'session_1' }]);
        dbMock.usageReport.findMany.mockResolvedValueOnce([
            { data: null }, { data: {} }, { data: { cost: { total: '9' } } },
            { data: { cost: { total: Number.NaN } } }, { data: { cost: { total: 4 } } },
        ]);
        expect((await teammateSpendGet('account_1', 'mate_1', updatedAt))?.spentUsd).toBe(4);
    });

    it('sums Claude and Codex token shapes, including reasoning output', async () => {
        dbMock.teammateSession.findMany.mockResolvedValueOnce([{ sessionId: 'session_1' }]);
        dbMock.usageReport.findMany.mockResolvedValueOnce([
            { data: { cost: { total: 1 }, tokens: { input: 2, cache_read: 3, cache_creation: 4, output: 5 } } },
            { data: { cost: { total: 2 }, tokens: { input: 7, cache_read: 11, cache_creation: 0, output: 13, reasoning: 17 } } },
        ]);
        expect((await teammateSpendGet('account_1', 'mate_1', updatedAt))?.tokens).toEqual({ input: 9, cacheRead: 14, cacheWrite: 4, output: 35 });
    });

    it('returns null for a missing or foreign teammate without reading usage reports', async () => {
        dbMock.teammate.findFirst.mockResolvedValueOnce(null);
        expect(await teammateSpendGet('account_1', 'foreign', updatedAt)).toBeNull();
        expect(dbMock.teammateSession.findMany).not.toHaveBeenCalled();
        expect(dbMock.usageReport.findMany).not.toHaveBeenCalled();
    });
});

describe('teammate REST contract', () => {
    let app: Fastify;
    beforeEach(() => {
        app = fastify().withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
            if (request.headers.authorization !== 'Bearer test') return reply.code(401).send({ error: 'Unauthorized' });
            request.userId = 'account_1';
        });
        teammateRoutes(app);
    });
    afterEach(async () => { await app.close(); });
    const headers = { authorization: 'Bearer test' };

    it('serves all eight endpoints with their documented response keys', async () => {
        const endpoints = [
            { method: 'GET', url: '/v1/teammates', key: 'teammates' },
            { method: 'POST', url: '/v1/teammates', payload: createInput, key: 'teammate' },
            { method: 'GET', url: '/v1/teammates/mate_1', key: 'teammate' },
            { method: 'POST', url: '/v1/teammates/mate_1', payload: { name: 'New' }, key: 'teammate' },
            { method: 'POST', url: '/v1/teammates/mate_1/archive', key: 'teammate' },
            { method: 'GET', url: '/v1/teammates/mate_1/runs', key: 'runs' },
            { method: 'GET', url: '/v1/teammates/mate_1/tasks', key: 'tasks' },
            { method: 'GET', url: '/v1/teammates/mate_1/spend', key: 'spend' },
        ] as const;
        for (const endpoint of endpoints) {
            const response = await app.inject({ ...endpoint, headers });
            expect(response.statusCode, endpoint.url).toBe(200);
            expect(response.json()).toHaveProperty(endpoint.key);
        }
    });

    it('authenticates every endpoint', async () => {
        for (const url of ['/v1/teammates', '/v1/teammates/mate_1', '/v1/teammates/mate_1/runs', '/v1/teammates/mate_1/tasks', '/v1/teammates/mate_1/spend']) {
            expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
        }
        for (const [url, payload] of [
            ['/v1/teammates', createInput], ['/v1/teammates/mate_1', { name: 'New' }], ['/v1/teammates/mate_1/archive', {}],
        ] as const) {
            expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
        }
        expect(dbMock.teammate.findFirst).not.toHaveBeenCalled();
        expect(dbMock.teammate.create).not.toHaveBeenCalled();
    });

    it('returns invalid_request for invalid create/update bodies and invalid query parameters', async () => {
        for (const request of [
            { method: 'POST', url: '/v1/teammates', payload: { ...createInput, handle: 'INVALID' } },
            { method: 'POST', url: '/v1/teammates/mate_1', payload: { status: 'archived' } },
            { method: 'GET', url: '/v1/teammates?includeArchived=anything' },
            { method: 'GET', url: '/v1/teammates/mate_1/runs?limit=201' },
            { method: 'GET', url: '/v1/teammates/mate_1/runs?before=NaN' },
            { method: 'GET', url: '/v1/teammates/mate_1/tasks?status=done' },
        ] as const) {
            const response = await app.inject({ ...request, headers });
            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ error: 'invalid_request' });
        }
    });

    it('returns documented domain error codes and status codes', async () => {
        dbMock.machine.findFirst.mockResolvedValueOnce(null);
        const missingMachine = await app.inject({ method: 'POST', url: '/v1/teammates', payload: createInput, headers });
        expect(missingMachine.statusCode).toBe(400);
        expect(missingMachine.json()).toEqual({ error: 'machine_not_found' });
        dbMock.teammate.findFirst.mockResolvedValueOnce({ id: 'mate_2' });
        const duplicate = await app.inject({ method: 'POST', url: '/v1/teammates', payload: createInput, headers });
        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.json()).toEqual({ error: 'name_taken' });
        dbMock.teammate.findFirst.mockResolvedValueOnce({ ...profile, status: 'archived' });
        const archived = await app.inject({ method: 'POST', url: '/v1/teammates/mate_1', payload: { name: 'New' }, headers });
        expect(archived.statusCode).toBe(409);
        expect(archived.json()).toEqual({ error: 'archived' });
    });

    it('returns 404 for every endpoint addressing a missing or foreign teammate', async () => {
        dbMock.teammate.findFirst.mockResolvedValue(null);
        for (const request of [
            { method: 'GET', url: '/v1/teammates/foreign' },
            { method: 'POST', url: '/v1/teammates/foreign', payload: { name: 'New' } },
            { method: 'POST', url: '/v1/teammates/foreign/archive' },
            { method: 'GET', url: '/v1/teammates/foreign/runs' },
            { method: 'GET', url: '/v1/teammates/foreign/tasks' },
            { method: 'GET', url: '/v1/teammates/foreign/spend' },
        ] as const) {
            const response = await app.inject({ ...request, headers });
            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ error: 'not_found' });
        }
    });
});
