import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const mocks = vi.hoisted(() => {
    const agentFindFirst = vi.fn();
    const agentUpdate = vi.fn();
    const tx = {
        $queryRaw: vi.fn(),
        aiAgent: { findFirst: agentFindFirst, update: agentUpdate },
        aiTeam: { count: vi.fn() },
        aiWorkspace: { findUnique: vi.fn() },
        orchestratorRun: { create: vi.fn() },
        orchestratorTask: { create: vi.fn(), count: vi.fn() },
        orchestratorExecution: { create: vi.fn() },
        aiWorkItem: { create: vi.fn(), update: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
        aiMessage: { create: vi.fn() },
        aiConversation: { update: vi.fn() },
        aiInboundRequest: { updateMany: vi.fn() },
        aiSkillAgentBinding: { findMany: vi.fn() },
    };
    return {
        tx,
        transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
        agentFindFirst,
        agentFindFirstOrThrow: vi.fn(),
        agentCount: vi.fn(),
        agentUpdate,
        conversationUpsert: vi.fn(),
        conversationFindFirst: vi.fn(),
        workFindFirst: vi.fn(),
        workUpdate: vi.fn(),
        listMethods: vi.fn(),
        invokeRpc: vi.fn(),
        inboundCreate: vi.fn(),
        inboundFindUnique: vi.fn(),
        inboundUpdateMany: vi.fn(),
        grantUpsert: vi.fn(),
        repoGet: vi.fn(),
        issueGet: vi.fn(),
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
            update: vi.fn(),
        },
        aiWorkItem: { findFirst: mocks.workFindFirst, update: mocks.workUpdate },
        aiInboundRequest: { create: mocks.inboundCreate, findUnique: mocks.inboundFindUnique, updateMany: mocks.inboundUpdateMany },
        aiGithubRepositoryGrant: { upsert: mocks.grantUpsert },
    },
}));

vi.mock('@/app/github/githubApi', () => ({
    getUserOctokit: vi.fn(async () => ({ rest: { repos: { get: mocks.repoGet }, issues: { get: mocks.issueGet } } })),
}));

vi.mock('../socket/rpcRegistry', () => ({
    listConnectedUserRpcMethods: mocks.listMethods,
    invokeUserRpc: mocks.invokeRpc,
}));

import { aiTeamRoutes, boundedOutput, classifyCoordinatorMessage } from './aiTeamRoutes';

const settings = {
    instructions: 'Make the requested code change.',
    engine: 'claude-code',
    model: 'default',
    workingDirectory: '/workspace/project',
    permissionMode: 'guarded_auto',
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
        mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', agentId: 'agent-1', teamId: null });
        mocks.tx.orchestratorRun.create.mockResolvedValue({ id: 'run-1' });
        mocks.tx.orchestratorTask.create.mockResolvedValue({ id: 'task-1' });
        mocks.tx.aiWorkItem.create.mockResolvedValue({ id: 'work-1' });
        mocks.tx.aiMessage.create.mockResolvedValue({ id: 'message-1' });
        mocks.tx.aiConversation.update.mockResolvedValue({});
        mocks.tx.aiInboundRequest.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.aiSkillAgentBinding.findMany.mockResolvedValue([]);
        mocks.tx.aiWorkspace.findUnique.mockResolvedValue(null);
        mocks.tx.$queryRaw.mockResolvedValue([{ id: 'agent-1' }]);
        mocks.tx.aiTeam.count.mockResolvedValue(0);
        mocks.tx.aiWorkItem.count.mockResolvedValue(0);
        mocks.tx.orchestratorTask.count.mockResolvedValue(0);
        mocks.inboundCreate.mockResolvedValue({});
        mocks.repoGet.mockResolvedValue({ data: { id: 42, full_name: 'acme/project', permissions: { push: true } } });
        mocks.issueGet.mockResolvedValue({ data: { number: 42 } });
        mocks.grantUpsert.mockResolvedValue({});
    });

    afterAll(async () => app.close());

    it('classifies casual conversation without promoting it to work', () => {
        expect(classifyCoordinatorMessage('你好，今天进展怎么样？')).toBe('chat');
        expect(classifyCoordinatorMessage('What can you help me with?')).toBe('chat');
        expect(classifyCoordinatorMessage('Please add a health check endpoint.')).toBe('task');
        expect(classifyCoordinatorMessage('请修复登录页面的 bug 并补充测试')).toBe('task');
        expect(classifyCoordinatorMessage('我有一个需求，可以帮我吗？')).toBe('clarify');
        expect(classifyCoordinatorMessage('请介绍一下这个代码项目')).toBe('chat');
    });

    it('keeps casual conversation out of the orchestrator', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', name: 'Coordinator', description: 'Answers questions',
            instructions: 'Be helpful.', responsibilities: [], settings, enabled: true,
        });
        const response = await app.inject({
            method: 'POST', url: '/v1/ai-team/conversations/conversation-1/messages',
            payload: { text: '你好，能介绍一下你自己吗？', clientMessageId: 'chat-1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ kind: 'chat', conversationId: 'conversation-1', runId: 'run-1' });
        expect(mocks.tx.orchestratorRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ coordinatorChat: true }) }) });
        expect(mocks.tx.aiWorkItem.create).not.toHaveBeenCalled();
    });

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
                agentId: 'agent-1', clientMessageId: 'assignment-1', title: 'Implement feature', summary: 'Implement it and run tests.',
                sourceType: 'execution', sourceLabel: 'Direct assignment',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({
            workItemId: 'work-1', executionId: 'task-1', conversationId: 'conversation-1', runId: 'run-1',
        });
        expect(mocks.tx.orchestratorTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            runId: 'run-1', provider: 'claude', workingDirectory: '/workspace/project',
            permissionMode: 'guarded_auto', targetMachineId: 'machine-1', status: 'queued',
        }) });
        expect(mocks.tx.aiWorkItem.create).toHaveBeenCalledOnce();
        expect(mocks.tx.aiMessage.create).toHaveBeenCalledOnce();
    });

    it('returns the committed response when a client retries after losing the response', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: [], settings, enabled: true,
        });
        const payload = { agentId: 'agent-1', clientMessageId: 'same-request', title: 'Fix task', summary: 'Fix task' };
        const first = await app.inject({ method: 'POST', url: '/v1/ai-team/assignments', payload });
        expect(first.statusCode).toBe(201);
        mocks.inboundCreate.mockRejectedValueOnce({ code: 'P2002' });
        mocks.inboundFindUnique.mockResolvedValueOnce({
            payloadHash: mocks.inboundCreate.mock.calls[0][0].data.payloadHash,
            status: 'completed', response: first.json(),
        });
        const second = await app.inject({ method: 'POST', url: '/v1/ai-team/assignments', payload });
        expect(second.statusCode).toBe(201);
        expect(second.json()).toEqual(first.json());
        expect(mocks.tx.aiWorkItem.create).toHaveBeenCalledOnce();
    });

    it('rejects approval without a trusted compatible machine protocol before creating a run', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: [], settings: { ...settings, permissionMode: 'approval' }, enabled: true,
        });
        const response = await app.inject({ method: 'POST', url: '/v1/ai-team/assignments',
            payload: { agentId: 'agent-1', clientMessageId: 'approval-task', title: 'Implement', summary: 'Implement it' } });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('AI_APPROVAL_RUNTIME_UNSUPPORTED');
        expect(mocks.tx.orchestratorRun.create).not.toHaveBeenCalled();
    });

    it('persists GitHub issue identity on the work item for result and PR association', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: ['Implement'], settings, enabled: true,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/ai-team/assignments',
            payload: {
                agentId: 'agent-1', clientMessageId: 'assignment-2', title: 'Fix issue', summary: 'Fix the bug.',
                sourceType: 'github', sourceLabel: 'GitHub acme/project#42', sourceResourceId: 'acme/project#42',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(mocks.tx.aiWorkItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            sourceType: 'github', sourceLabel: 'GitHub acme/project#42', sourceResourceId: 'acme/project#42',
        }) });
    });

    it('starts a new task without reusing the previous child session', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: ['Implement'], settings, enabled: true,
        });
        mocks.conversationUpsert.mockResolvedValue({ id: 'conversation-1', agentId: 'agent-1', teamId: null });
        mocks.workFindFirst.mockResolvedValue({
            id: 'previous-work', orchestratorTaskId: 'previous-task',
            orchestratorRun: { tasks: [{ id: 'previous-task', executions: [{ childSessionId: 'child-session-1' }] }] },
        });

        const response = await app.inject({
            method: 'POST', url: '/v1/ai-team/conversations/conversation-1/messages',
            payload: { text: '继续修复并运行测试', clientMessageId: 'task-3' },
        });

        expect(response.statusCode).toBe(201);
        expect(mocks.tx.orchestratorExecution.create).not.toHaveBeenCalled();
    });

    it('turns a GitHub issue link posted in team chat into a linked work item', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: ['Implement'], settings, enabled: true,
        });

        const response = await app.inject({
            method: 'POST', url: '/v1/ai-team/conversations/conversation-1/messages',
            payload: { text: 'Please implement https://github.com/acme/project/issues/42 and open a PR.', clientMessageId: 'task-4' },
        });

        expect(response.statusCode).toBe(201);
        expect(mocks.tx.aiWorkItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            sourceType: 'github', sourceLabel: 'GitHub acme/project#42', sourceResourceId: 'acme/project#42',
        }) });
        expect(mocks.tx.orchestratorTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            prompt: expect.stringContaining('Closes #42'),
        }) });
    });

    it('instructs an unlinked team request to create an issue and PR from the repository', async () => {
        mocks.agentFindFirst.mockResolvedValue({
            id: 'agent-1', accountId: 'account-1', name: 'Builder', role: 'Engineer',
            description: 'Builds features', instructions: settings.instructions,
            responsibilities: ['Implement'], settings, enabled: true,
        });

        const response = await app.inject({
            method: 'POST', url: '/v1/ai-team/conversations/conversation-1/messages',
            payload: { text: 'Please add a health check endpoint and ship it.', clientMessageId: 'task-5' },
        });

        expect(response.statusCode).toBe(201);
        expect(mocks.tx.orchestratorTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            prompt: expect.stringContaining('create a concise GitHub Issue'),
        }) });
        expect(mocks.tx.orchestratorTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            prompt: expect.stringContaining('Closes #<new issue number>'),
        }) });
        expect(mocks.tx.aiWorkItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            title: 'Please add a health check endpoint and ship it.',
            conversationId: 'conversation-1',
            assigneeId: 'agent-1',
        }) });
    });

    it('scopes agent deletion to the authenticated account and archives without deleting history', async () => {
        mocks.agentFindFirst.mockResolvedValue({ id: 'agent-1', ledTeams: [] });
        mocks.agentUpdate.mockResolvedValue({});

        const response = await app.inject({ method: 'DELETE', url: '/v1/ai-team/agents/agent-1' });

        expect(response.statusCode).toBe(204);
        expect(mocks.tx.$queryRaw).toHaveBeenCalled();
        expect(mocks.tx.aiWorkItem.count).toHaveBeenCalledWith({ where: {
            accountId: 'account-1', assigneeId: 'agent-1',
            orchestratorRun: { status: { in: ['queued', 'running', 'canceling'] } },
        } });
        expect(mocks.agentUpdate).toHaveBeenCalledWith({
            where: { id: 'agent-1' }, data: { archivedAt: expect.any(Date), enabled: false },
        });
    });

    it('rejects access to an agent owned by another account', async () => {
        mocks.tx.$queryRaw.mockResolvedValue([]);
        const response = await app.inject({ method: 'DELETE', url: '/v1/ai-team/agents/other-agent' });
        expect(response.statusCode).toBe(404);
        expect(mocks.agentUpdate).not.toHaveBeenCalled();
    });

    it('requires a stable client message identity before requesting changes', async () => {
        mocks.tx.aiWorkItem.findUnique.mockResolvedValue({ id: 'original-work',
            accountId: 'account-1', projectId: null, assigneeId: 'agent-1',
            conversationId: 'conversation-1', orchestratorRunId: 'run-1',
            orchestratorTaskId: 'completed-task' });
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

        expect(response.statusCode).toBe(400);
        expect(mocks.tx.orchestratorTask.create).not.toHaveBeenCalled();
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
