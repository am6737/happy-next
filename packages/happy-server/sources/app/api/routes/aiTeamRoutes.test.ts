import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const mocks = vi.hoisted(() => {
    const tx = {
        orchestratorRun: { create: vi.fn() },
        orchestratorTask: { create: vi.fn() },
        aiWorkItem: { create: vi.fn(), update: vi.fn() },
        aiMessage: { create: vi.fn() },
        aiConversation: { update: vi.fn() },
    };
    return {
        tx,
        transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
        agentFindFirst: vi.fn(),
        agentFindFirstOrThrow: vi.fn(),
        agentCount: vi.fn(),
        agentUpdate: vi.fn(),
        conversationUpsert: vi.fn(),
        conversationFindFirst: vi.fn(),
        workFindFirst: vi.fn(),
        workUpdate: vi.fn(),
        listMethods: vi.fn(),
        invokeRpc: vi.fn(),
    };
});

vi.mock('@/storage/db', () => ({
    db: {
        $transaction: mocks.transaction,
        aiAgent: {
            findFirst: mocks.agentFindFirst,
            findFirstOrThrow: mocks.agentFindFirstOrThrow,
            count: mocks.agentCount,
            update: mocks.agentUpdate,
        },
        aiTeam: { findFirst: vi.fn() },
        aiConversation: {
            upsert: mocks.conversationUpsert,
            findFirst: mocks.conversationFindFirst,
        },
        aiWorkItem: { findFirst: mocks.workFindFirst, update: mocks.workUpdate },
    },
}));

vi.mock('../socket/rpcRegistry', () => ({
    listConnectedUserRpcMethods: mocks.listMethods,
    invokeUserRpc: mocks.invokeRpc,
}));

import { aiTeamRoutes, boundedOutput } from './aiTeamRoutes';

const settings = {
    instructions: 'Make the requested code change.',
    engine: 'claude-code',
    model: 'default',
    workingDirectory: '/workspace/project',
    permissionMode: 'approval',
    allowDelegation: true,
};

describe('AI team routes', () => {
    const app = fastify();

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listMethods.mockReturnValue(['machine-1:orchestrator-dispatch', 'machine-1:bash']);
        mocks.invokeRpc.mockResolvedValue({ success: true, stdout: 'claude:true\ncodex:false\ngemini:false\n' });
        mocks.agentCount.mockResolvedValue(1);
        mocks.agentFindFirstOrThrow.mockResolvedValue({ id: 'agent-1', name: 'Builder' });
        mocks.conversationUpsert.mockResolvedValue({ id: 'conversation-1', agentId: 'agent-1', teamId: null });
        mocks.tx.orchestratorRun.create.mockResolvedValue({ id: 'run-1' });
        mocks.tx.orchestratorTask.create.mockResolvedValue({ id: 'task-1' });
        mocks.tx.aiWorkItem.create.mockResolvedValue({ id: 'work-1' });
        mocks.tx.aiMessage.create.mockResolvedValue({ id: 'message-1' });
        mocks.tx.aiConversation.update.mockResolvedValue({});
    });

    afterAll(async () => app.close());

    it('creates a real run, task, work item, and message atomically', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: ['Implement'], settings, enabled: true,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/ai-team/assignments',
            payload: {
                agentId: 'agent-1', title: 'Implement feature', summary: 'Implement it and run tests.',
                sourceType: 'execution', sourceLabel: 'Direct assignment',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({
            workItemId: 'work-1', executionId: 'task-1', conversationId: 'conversation-1', runId: 'run-1',
        });
        expect(mocks.tx.orchestratorTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            runId: 'run-1', provider: 'claude', workingDirectory: '/workspace/project',
            permissionMode: 'approval', targetMachineId: 'machine-1', status: 'queued',
        }) });
        expect(mocks.tx.aiWorkItem.create).toHaveBeenCalledOnce();
        expect(mocks.tx.aiMessage.create).toHaveBeenCalledOnce();
    });

    it('scopes agent deletion to the authenticated account and archives without deleting history', async () => {
        mocks.agentFindFirst.mockResolvedValue({ id: 'agent-1', ledTeams: [] });
        mocks.agentUpdate.mockResolvedValue({});

        const response = await app.inject({ method: 'DELETE', url: '/v1/ai-team/agents/agent-1' });

        expect(response.statusCode).toBe(204);
        expect(mocks.agentFindFirst).toHaveBeenCalledWith({ where: {
            id: 'agent-1', accountId: 'account-1', archivedAt: null,
        }, include: { ledTeams: { where: { archivedAt: null } } } });
        expect(mocks.agentUpdate).toHaveBeenCalledWith({
            where: { id: 'agent-1' }, data: { archivedAt: expect.any(Date), enabled: false },
        });
    });

    it('rejects access to an agent owned by another account', async () => {
        mocks.agentFindFirst.mockResolvedValue(null);
        const response = await app.inject({ method: 'DELETE', url: '/v1/ai-team/agents/other-agent' });
        expect(response.statusCode).toBe(404);
        expect(mocks.agentUpdate).not.toHaveBeenCalled();
    });

    it('creates a real revision task before marking completed work for changes', async () => {
        mocks.workFindFirst.mockResolvedValue({
            id: 'original-work', title: 'Implement feature', assigneeId: 'agent-1', teamId: null,
            conversationId: 'conversation-1', orchestratorTaskId: 'completed-task',
            orchestratorRun: { tasks: [{ id: 'completed-task', status: 'completed' }] },
        });
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', name: 'Builder', role: 'Engineer', description: 'Builds features',
            instructions: settings.instructions, responsibilities: [], settings, enabled: true,
        });
        mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', agentId: 'agent-1', teamId: null });
        mocks.workUpdate.mockResolvedValue({});

        const response = await app.inject({
            method: 'POST',
            url: '/v1/ai-team/work-items/original-work/acceptance',
            payload: { status: 'changes_requested', note: 'Add the missing test.' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ ok: true, revision: { executionId: 'task-1' } });
        expect(mocks.tx.orchestratorTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            title: 'Revise: Implement feature', targetMachineId: 'machine-1',
        }) });
        expect(mocks.workUpdate).toHaveBeenCalledWith({
            where: { id: 'original-work' },
            data: { acceptanceStatus: 'changes_requested', requiresDecision: false },
        });
    });

    it('does not expose oversized execution output in chat state', () => {
        expect(boundedOutput('x'.repeat(8_001))).toContain('too large');
        expect(boundedOutput('complete')).toBe('complete');
    });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: any) => {
        request.userId = 'account-1';
    });
    aiTeamRoutes(app as unknown as Fastify);
});
