import { db } from '@/storage/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isApprovalTerminalFailure } from '@/app/ai/approvalTerminalFailure';
import { safeErrorCode } from '@/app/ai/safeErrorCode';
import { randomUUID } from 'node:crypto';
import { claimInbound, failInbound, type InboundClaim } from './aiInboundRequest';
import type { Fastify } from '../types';
import type {
    AiAgent,
    AiAgentSettings,
    AiChatMessage,
    AiConversation,
    AiExecution,
    AiExecutionEvent,
    AiTeam,
    AiTeamData,
    AiWorkItem,
} from 'happy-wire';
import { invokeUserRpc, listConnectedUserRpcMethods } from '../socket/rpcRegistry';
import { getUserOctokit } from '@/app/github/githubApi';
import { findAuthorizedInstallation } from '@/app/github/githubInstallation';
import { requestStructuredModel } from '@/app/ai/modelGateway';
import { buildCoordinatorPrompt } from '@/app/ai/coordinatorPrompt';
import { reserveAiRunBudgetTx } from '@/app/ai/budget';
import { loadDispatchProjectSnapshot } from '@/app/ai/projectSnapshot';
import { COORDINATOR_RUNTIME_CONTRACT, WORK_ITEM_RUNTIME_CONTRACT } from '@/app/ai/runtimeContract';
import { findGithubIssueForIntent, reconcileGithubIssueIntent, verifyGithubIssueNumber } from '@/app/ai/githubIssueIntent';
import { aiDelegationRoutes } from './aiDelegationRoutes';
import { aiProjectRoutes } from './aiProjectRoutes';
import { aiSkillRoutes } from './aiSkillRoutes';
import { aiAutopilotRoutes } from './aiAutopilotRoutes';
import { aiWorkspaceRoutes } from './aiWorkspaceRoutes';
import { aiExecutionEventRoutes } from './aiExecutionEventRoutes';
import { aiBudgetRoutes } from './aiBudgetRoutes';
import { aiDecisionRoutes } from './aiDecisionRoutes';
import { aiWorkItemCollaborationRoutes } from './aiWorkItemCollaborationRoutes';
import { aiAgentTemplateRoutes } from './aiAgentTemplateRoutes';
import { authorizeWorkspace, authorizeWorkItemTx } from '@/app/ai/workspaceAuth';
import { AiConversationMessageInputSchema, AiCoordinatorContextSchema, AiCoordinatorDecisionSchema } from 'happy-wire';

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;
type Provider = typeof PROVIDERS[number];
const PROVIDER_DETECTION_TIMEOUT_MS = 5_000;
const PROVIDER_CACHE_TTL_MS = 30_000;
const providerMachineCache = new Map<string, {
    expiresAt: number;
    machineSignature: string;
    machines: Map<Provider, string>;
}>();

const agentSettingsSchema = z.object({
    instructions: z.string().max(65_536),
    engine: z.enum(['claude-code', 'codex', 'gemini']),
    model: z.string().max(128),
    workingDirectory: z.string().max(1024),
    permissionMode: z.enum(['read_only', 'approval', 'guarded_auto']),
    allowDelegation: z.boolean(),
});

const agentInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    role: z.string().trim().max(200),
    description: z.string().trim().min(1).max(4000),
    emoji: z.string().max(32),
    skills: z.array(z.string().max(200)).max(64),
    responsibilities: z.array(z.string().max(500)).max(64),
    settings: agentSettingsSchema,
    enabled: z.boolean().default(true),
});

const agentGenerationSchema = z.object({
    prompt: z.string().trim().min(3).max(8000),
});

const generatedAgentContentSchema = z.object({
    name: z.string().min(1).max(100), role: z.string().max(200), description: z.string().min(1).max(4000),
    emoji: z.string().max(32), skills: z.array(z.string().max(200)).max(64), responsibilities: z.array(z.string().max(500)).max(64),
    instructions: z.string().max(65_536),
});

async function generateAgentDraft(accountId: string, prompt: string) {
    const generated = await requestStructuredModel({ accountId,
        model: process.env.OPENAI_AGENT_GENERATOR_MODEL,
        schema: generatedAgentContentSchema,
        prompt: `Create an AI coding agent definition. Return only JSON with name, role, description, emoji, skills:string[], responsibilities:string[], instructions:string. Do not choose a runtime, model, path or permissions.\n\nUser request:\n${prompt}`,
    });
    return {
        name: generated.name, role: generated.role, description: generated.description,
        emoji: generated.emoji, skills: generated.skills, responsibilities: generated.responsibilities,
        settings: { instructions: generated.instructions, engine: 'codex', model: 'default',
            workingDirectory: '', permissionMode: 'approval', allowDelegation: false },
    };
}

const teamInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(4000),
    emoji: z.string().max(32),
    leaderId: z.string().min(1),
    memberIds: z.array(z.string().min(1)).min(1).max(64),
    instructions: z.string().max(65_536),
    currentGoal: z.string().max(4000).default(''),
});

const assignmentSchema = z.object({
    clientMessageId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
    agentId: z.string().min(1),
    teamId: z.string().optional(),
    conversationId: z.string().optional(),
    title: z.string().trim().min(1).max(256),
    summary: z.string().trim().min(1).max(65_536),
    sourceType: z.enum(['github', 'dootask', 'session', 'execution']).default('execution'),
    sourceLabel: z.string().max(512).default('Direct assignment'),
    sourceResourceId: z.string().max(1024).optional(),
});

const messageSchema = AiConversationMessageInputSchema;
const acceptanceSchema = z.object({
    status: z.enum(['approved', 'changes_requested']),
    reviewedExecutionId: z.string().min(1).optional(),
    note: z.string().trim().max(65_536).optional(),
    clientMessageId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
});

const GITHUB_REPOSITORY_URL = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s#]+)(?:\/issues\/(\d+))?/i;

function repositoryFromRemote(remote: string): { owner: string; repo: string } | null {
    const value = remote.trim();
    const match = value.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    return match ? { owner: match[1], repo: match[2] } : null;
}

async function probeTaskRepository(accountId: string, machineId: string, workingDirectory: string) {
    if (!workingDirectory) return null;
    try {
        const quoted = `'${workingDirectory.replace(/'/g, "'\\''")}'`;
        const response = await invokeUserRpc(accountId, `${machineId}:bash`, {
            command: `git -C ${quoted} remote get-url origin`, cwd: '/', timeout: 5_000,
        }, 6_000) as { success?: boolean; stdout?: string };
        if (!response.success || !response.stdout) return null;
        const parsed = repositoryFromRemote(response.stdout);
        if (!parsed) return null;
        const octokit = await getUserOctokit(accountId);
        const { data: repository } = await octokit.rest.repos.get({ ...parsed, request: { signal: AbortSignal.timeout(15_000) } });
        if (!repository.permissions?.push) return null;
        const installationId = await findAuthorizedInstallation(accountId, BigInt(repository.id));
        await db.aiGithubRepositoryGrant.upsert({
            where: { accountId_repositoryId: { accountId, repositoryId: BigInt(repository.id) } },
            create: { accountId, repositoryId: BigInt(repository.id), fullName: repository.full_name, installationId },
            update: { fullName: repository.full_name, installationId, verifiedAt: new Date() },
        });
        return { id: String(repository.id), fullName: repository.full_name };
    } catch { return null; }
}

/**
 * Mika-style front door for conversations.  A conversation is allowed to be
 * ordinary chat; only messages that contain an actionable delivery request
 * are promoted to an orchestrator work item.  This intentionally stays
 * deterministic so a transient model failure cannot create duplicate work.
 */
export function classifyCoordinatorMessage(text: string): 'chat' | 'clarify' | 'task' {
    const value = text.trim();
    if (!value) return 'chat';
    const questionLike = /[?？]|^(?:请)?(?:什么|为什么|如何|怎么|能否|可以吗|介绍|解释|查看|状态)|^(?:what|why|how|can you explain|tell me|is there)\b/i.test(value);
    const explanatory = /(?:介绍|解释|分析|查看|了解|说明|explain|describe|analy[sz]e|look at|status|progress)/i.test(value);
    if (questionLike && explanatory) return 'chat';
    if (GITHUB_REPOSITORY_URL.test(value)) return questionLike ? 'clarify' : 'task';

    // Explicit delivery verbs are the strongest signal in both languages.
    const deliveryVerb = /(?:\b(?:implement|build|add|create|fix|refactor|update)\b|改造|实现|开发|增加|添加|修复|重构|编写|提交|发布|上线|部署|完成)/i.test(value);
    const requestLead = /^(?:请|帮我|麻烦|需要你|能否|可以帮我|我需要|我有(?:个|一个)需求|有个需求|\b(?:i want you to|i need|we need|please|could you|can you|would you)\b)/i.test(value);
    const softwareObject = /(代码|项目|仓库|接口|功能|页面|服务|bug|issue|pr|pull request|test|测试|endpoint|feature|repository|code|deploy)/i.test(value);
    if ((deliveryVerb && (requestLead || softwareObject)) || (requestLead && softwareObject)) return questionLike ? 'clarify' : 'task';

    if (requestLead && !softwareObject && !deliveryVerb) return 'clarify';

    // Long, structured messages usually describe work even when they omit an
    // imperative verb (for example, a pasted acceptance specification).
    const hasAcceptanceLanguage = /(验收标准|交付|需求如下|acceptance criteria|definition of done)/i.test(value);
    if (hasAcceptanceLanguage && value.length >= 40) return 'task';
    return 'chat';
}

const coordinatorDecisionSchema = z.object({
    action: z.enum(['chat', 'clarify', 'create_task', 'update_task', 'delegate']),
    question: z.string().max(500).optional(),
    targetWorkItemId: z.string().optional(),
    assigneeId: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
});

/** Ask a configured model only for ambiguous messages. Deterministic rules
 * remain the fast path and the safe fallback, so model outages cannot create
 * duplicate work or turn ordinary conversation into tasks. */
export async function classifyCoordinatorMessageWithModel(text: string, accountId?: string,
    conversationId?: string): Promise<{ intent: 'chat' | 'clarify' | 'task'; question?: string }> {
    const deterministic = classifyCoordinatorMessage(text);
    const obvious = /(?:实现|修复|开发|添加|重构|implement|build|fix|refactor|pull request|github\.com\/[^\s]+\/issues\/\d+)/i.test(text);
    if (obvious || (!accountId && !process.env.OPENAI_API_KEY?.trim())) return { intent: deterministic };
    try {
        const [history, works, conversation] = accountId && conversationId ? await Promise.all([
            db.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 12,
                select: { sender: true, payload: true } }),
            db.aiWorkItem.findMany({ where: { accountId, conversationId }, orderBy: { createdAt: 'desc' }, take: 8,
                select: { id: true, title: true, acceptanceStatus: true } }),
            db.aiConversation.findFirst({ where: { id: conversationId, accountId },
                include: { team: { include: { members: { include: { agent: true } } } } } }),
        ]) : [[], [], null];
        const context = {
            history: history.reverse().map((item) => ({ sender: item.sender,
                text: String((item.payload as { text?: string }).text ?? '').slice(0, 500) })),
            workItems: works, members: conversation?.team?.members.map((item) => ({
                id: item.agent.id, name: item.agent.name, enabled: item.agent.enabled,
            })) ?? [],
        };
        const result = await requestStructuredModel({
            accountId: accountId ?? 'server', model: process.env.OPENAI_COORDINATOR_MODEL,
            schema: coordinatorDecisionSchema,
            prompt: `Choose one action for this AI team message: chat, clarify, create_task, update_task, delegate. Return JSON with action, optional question, targetWorkItemId, assigneeId, confidence. Existing work and members are context only; do not invent IDs. update_task requires an explicit user target. delegate requires an authorized Leader operation.\n\nContext:\n${JSON.stringify(context).slice(0, 6_000)}\n\nMessage:\n${text}`,
        });
        if (result.confidence !== undefined && result.confidence < 0.6) return { intent: 'clarify', question: result.question };
        if (result.action === 'chat') return { intent: 'chat' };
        if (result.action === 'clarify' || result.action === 'update_task') return {
            intent: 'clarify', question: result.question ?? '请明确要处理的任务和验收条件。',
        };
        return { intent: 'task' };
    } catch {
        return { intent: deterministic };
    }
}

async function decideCoordinatorMessage(accountId: string, conversation: { id: string; teamId: string | null;
    agentId: string }, messageId: string, text: string, clarificationId?: string) {
    const [messages, works, pending, members, directAgent] = await Promise.all([
        db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' },
            take: 8, select: { id: true, sender: true, payload: true, agentId: true } }),
        db.aiWorkItem.findMany({ where: { accountId, conversationId: conversation.id },
            orderBy: { createdAt: 'desc' }, take: 5,
            select: { id: true, title: true, acceptanceStatus: true, assigneeId: true, summary: true } }),
        db.aiClarification.findFirst({ where: { accountId, conversationId: conversation.id, status: 'pending' },
            orderBy: { createdAt: 'desc' } }),
        conversation.teamId ? db.aiTeamMember.findMany({ where: { teamId: conversation.teamId,
            agent: { accountId, enabled: true, archivedAt: null } }, include: { agent: true }, take: 10 }) : [],
        conversation.teamId ? null : db.aiAgent.findFirst({ where: { id: conversation.agentId,
            accountId, enabled: true, archivedAt: null } }),
    ]);
    const context = AiCoordinatorContextSchema.parse({ version: 1, conversationId: conversation.id,
        history: messages.reverse().map((item) => ({ messageId: item.id,
            role: item.sender === 'user' ? 'human' : 'agent',
            text: String((item.payload as { text?: string }).text ?? '').slice(0, 500),
            ...(item.agentId ? { agentId: item.agentId } : {}) })),
        currentWorkItems: works.map((item) => ({ id: item.id, title: item.title.slice(0, 200),
            status: item.acceptanceStatus, assigneeId: item.assigneeId,
            requirements: item.summary.slice(0, 500) })),
        availableAgents: (conversation.teamId ? members.map(({ agent }) => agent)
            : directAgent ? [directAgent] : []).map((agent) => ({ id: agent.id, name: agent.name,
            teamIds: conversation.teamId ? [conversation.teamId] : [], enabled: agent.enabled,
            allowDelegation: !!(agent.settings as { allowDelegation?: boolean }).allowDelegation })),
        pendingClarification: pending ? { id: pending.id, originalMessageId: pending.clientMessageId,
            requirements: pending.originalText.slice(0, 1_000), question: pending.question.slice(0, 500),
            options: pending.options.slice(0, 6) } : null,
        project: null });
    const decision = await requestStructuredModel({ accountId, model: process.env.OPENAI_COORDINATOR_MODEL,
        schema: AiCoordinatorDecisionSchema,
        prompt: buildCoordinatorPrompt({ context, messageId, text, clarificationId }) });
    if ('source' in decision && (decision.source.conversationId !== conversation.id
        || decision.source.messageId !== messageId || decision.source.clarificationId !== clarificationId)) {
        throw new Error('Coordinator source identity mismatch');
    }
    return decision;
}

export async function resolveGithubChatSource(accountId: string, text: string, claim: InboundClaim): Promise<{
    sourceType: 'github';
    sourceLabel: string;
    sourceResourceId: string;
    deliveryInstruction: string;
} | null> {
    const match = text.match(GITHUB_REPOSITORY_URL);
    if (!match) return null;
    const [, owner, repo, issueNumber] = match;
    const octokit = await getUserOctokit(accountId);
    const { data: repository } = await octokit.rest.repos.get({ owner, repo, request: { signal: AbortSignal.timeout(15_000) } });
    if (!repository.permissions?.push) throw new Error('GitHub repository write access is required');
    const installationId = await findAuthorizedInstallation(accountId, BigInt(repository.id));
    await db.aiGithubRepositoryGrant.upsert({
        where: { accountId_repositoryId: { accountId, repositoryId: BigInt(repository.id) } },
        create: { accountId, repositoryId: BigInt(repository.id), fullName: repository.full_name, installationId },
        update: { fullName: repository.full_name, installationId, verifiedAt: new Date() },
    });
    if (issueNumber) {
        const resourceId = `${owner}/${repo}#${issueNumber}`;
        return {
            sourceType: 'github',
            sourceLabel: `GitHub ${resourceId}`,
            sourceResourceId: resourceId,
            deliveryInstruction: `This task is linked to GitHub Issue ${resourceId}. Implement the change, run validation, and create a pull request that includes "Closes #${issueNumber}" in its body.`,
        };
    }
    if (!/(?:create|open|file|提出|创建|新建).{0,12}(?:issue|需求|议题)/i.test(text)) return null;
    const title = text.split(/\r?\n/, 1)[0].replace(GITHUB_REPOSITORY_URL, '').trim().slice(0, 256) || 'AI Agent request';
    const intentKey = { accountId, conversationId: claim.conversationId, clientMessageId: claim.clientMessageId };
    const marker = `<!-- happy-ai-intent:${accountId}:${claim.conversationId}:${claim.clientMessageId} -->`;
    const issueBody = `${text}\n\n${marker}`;
    let intent = await db.aiGithubIssueIntent.findUnique({ where: { accountId_conversationId_clientMessageId: intentKey } });
    if (!intent) {
        intent = await db.aiGithubIssueIntent.create({ data: {
            ...intentKey, repositoryId: BigInt(repository.id), owner, repo, title, body: issueBody,
        } });
    }
    if (intent.repositoryId !== BigInt(repository.id) || intent.body !== issueBody) throw new Error('GitHub issue intent conflict');
    let createdIssueNumber = intent.issueNumber;
    if (!createdIssueNumber) {
        if (intent.status === 'creating' || intent.status === 'uncertain') {
            createdIssueNumber = await findGithubIssueForIntent(intent);
            if (!createdIssueNumber) throw new Error('GitHub issue creation is uncertain; no duplicate will be created');
        } else {
            const reserved = await db.aiGithubIssueIntent.updateMany({
                where: { ...intentKey, status: 'pending' }, data: { status: 'creating' },
            });
            if (!reserved.count) throw new Error('GitHub issue intent is processing');
            const { data: issue } = await octokit.rest.issues.create({ owner, repo, title, body: issueBody,
                request: { signal: AbortSignal.timeout(15_000) } });
            createdIssueNumber = issue.number;
        }
        await db.aiGithubIssueIntent.update({ where: { accountId_conversationId_clientMessageId: intentKey },
            data: { issueNumber: createdIssueNumber, status: 'succeeded' } });
    }
    const resourceId = `${owner}/${repo}#${createdIssueNumber}`;
    return {
        sourceType: 'github',
        sourceLabel: `GitHub ${resourceId}`,
        sourceResourceId: resourceId,
        deliveryInstruction: `This task is linked to GitHub Issue ${resourceId}. Implement the change, run validation, and create a pull request that includes "Closes #${createdIssueNumber}" in its body.`,
    };
}

type WorkWithRun = Prisma.AiWorkItemGetPayload<{
    include: {
        orchestratorRun: {
            include: { tasks: { include: { executions: true } } };
        };
    };
}>;

function providerFor(settings: AiAgentSettings): Provider {
    if (settings.engine === 'claude-code') return 'claude';
    return settings.engine;
}

async function detectProviderMachines(accountId: string): Promise<Map<Provider, string>> {
    const methods = new Set(listConnectedUserRpcMethods(accountId));
    const machineIds = [...methods]
        .filter((method) => method.endsWith(':orchestrator-dispatch'))
        .map((method) => method.slice(0, -':orchestrator-dispatch'.length))
        .filter((machineId) => methods.has(`${machineId}:bash`))
        .sort();
    const machineSignature = machineIds.join(',');
    const cached = providerMachineCache.get(accountId);
    if (cached && cached.expiresAt > Date.now() && cached.machineSignature === machineSignature) {
        return cached.machines;
    }

    const detected = new Map<Provider, string>();
    const command = PROVIDERS
        .map((provider) => `command -v ${provider} >/dev/null 2>&1 && echo "${provider}:true" || echo "${provider}:false"`)
        .join('; ');
    const results = await Promise.allSettled(machineIds.map(async (machineId) => {
        const response = await invokeUserRpc(accountId, `${machineId}:bash`, { command, cwd: '/' }, PROVIDER_DETECTION_TIMEOUT_MS) as {
            success?: boolean;
            stdout?: string;
        };
        return { machineId, response };
    }));
    for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value.response.success) continue;
        const available = new Set(result.value.response.stdout?.split('\n')
            .filter((line) => line.endsWith(':true'))
            .map((line) => line.slice(0, -':true'.length)) ?? []);
        for (const provider of PROVIDERS) {
            if (available.has(provider) && !detected.has(provider)) detected.set(provider, result.value.machineId);
        }
    }
    providerMachineCache.set(accountId, {
        expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
        machineSignature,
        machines: detected,
    });
    return detected;
}

function terminalTaskStatus(status: string): boolean {
    return ['completed', 'failed', 'cancelled', 'dependency_failed'].includes(status);
}

function workStatus(status: string): AiWorkItem['status'] {
    if (status === 'completed') return 'review';
    if (status === 'failed' || status === 'dependency_failed') return 'blocked';
    if (status === 'cancelled') return 'todo';
    return status === 'queued' ? 'todo' : 'working';
}

function executionStatus(status: string): AiExecution['status'] {
    if (status === 'dispatching') return 'dispatched';
    if (status === 'completed') return 'completed';
    if (status === 'failed' || status === 'dependency_failed' || status === 'timeout') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'queued') return 'queued';
    return 'running';
}

function statusLabel(status: AiExecution['status']): string {
    return ({
        queued: 'Queued',
        dispatched: 'Dispatched',
        running: 'Running',
        waiting_human: 'Waiting for human',
        reviewing: 'Reviewing',
        completed: 'Completed',
        failed: 'Failed',
        cancelled: 'Cancelled',
    })[status];
}

function timeLabel(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 16);
}

export function boundedOutput(value: string | null): string | null {
    if (!value) return null;
    if ([...value].length <= 8_000) return value;
    return 'This execution completed, but its output was too large to display safely. Open the execution Session to inspect the full result.';
}

function durationLabel(start: Date, end?: Date | null): string {
    const elapsed = Math.max(0, (end?.getTime() ?? Date.now()) - start.getTime());
    if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s`;
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
    return `${Math.floor(elapsed / 3_600_000)}h ${Math.floor((elapsed % 3_600_000) / 60_000)}m`;
}

function projectExecution(work: WorkWithRun): AiExecution & { errorCode: string | null } {
    const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId)
        ?? work.orchestratorRun.tasks[0];
    const attempts = [...(task?.executions ?? [])].sort((a, b) => a.attempt - b.attempt);
    const latest = attempts.at(-1);
    const status = executionStatus(task?.status ?? work.orchestratorRun.status);
    const events: AiExecutionEvent[] = [{
        id: `${work.id}-assigned`,
        kind: 'status',
        actor: 'human',
        title: 'Work assigned',
        body: work.summary,
        timeLabel: timeLabel(work.createdAt),
        status: 'queued',
    }];
    for (const attempt of attempts) {
        events.push({
            id: `${attempt.id}-dispatch`,
            kind: 'status',
            actor: 'system',
            title: `Attempt ${attempt.attempt} dispatched to ${attempt.machineId}`,
            timeLabel: timeLabel(attempt.createdAt),
            status: 'dispatched',
        });
        if (attempt.startedAt) events.push({
            id: `${attempt.id}-start`, kind: 'status', actor: 'agent', agentId: work.assigneeId,
            title: `Attempt ${attempt.attempt} started`, timeLabel: timeLabel(attempt.startedAt), status: 'running',
        });
        if (attempt.finishedAt) events.push({
            id: `${attempt.id}-finish`, kind: 'result', actor: 'agent', agentId: work.assigneeId,
            title: attempt.status === 'completed' ? 'Execution completed' : 'Execution ended',
            body: attempt.finalResponse ?? (attempt.status === 'completed' ? undefined : 'Execution did not complete'),
            timeLabel: timeLabel(attempt.finishedAt), status: executionStatus(attempt.status),
        });
    }
    return {
        id: task?.id ?? work.orchestratorTaskId,
        ...(latest ? { orchestratorExecutionId: latest.id } : {}),
        errorCode: safeErrorCode(latest ? latest.errorCode : task?.errorCode),
        workItemId: work.id,
        agentId: work.assigneeId,
        status,
        statusLabel: statusLabel(status),
        triggerLabel: 'Assigned by human',
        startedAt: timeLabel(latest?.startedAt ?? work.createdAt),
        durationLabel: durationLabel(latest?.startedAt ?? work.createdAt, latest?.finishedAt),
        summary: task?.finalResponse ?? work.summary,
        attempt: latest?.attempt ?? 1,
        conversationId: work.conversationId,
        sessionId: latest?.workerSessionId ?? latest?.childSessionId ?? undefined,
        events,
    };
}

function projectWork(work: WorkWithRun): AiWorkItem {
    const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId)
        ?? work.orchestratorRun.tasks[0];
    let status = workStatus(task?.status ?? work.orchestratorRun.status);
    if (status === 'review' && !['verified', 'local_accepted'].includes(work.deliveryVerificationStatus)) status = 'blocked';
    if (work.acceptanceStatus === 'approved' && ['verified', 'local_accepted'].includes(work.deliveryVerificationStatus)) status = 'done';
    return {
        id: work.id,
        title: work.title,
        status,
        statusLabel: status === 'done' ? 'Done' : status === 'review' ? 'Ready for review' : status === 'blocked' ? 'Blocked' : status === 'todo' ? 'Queued' : 'In progress',
        assigneeId: work.assigneeId,
        teamId: work.teamId ?? '',
        sourceType: work.sourceType as AiWorkItem['sourceType'],
        sourceLabel: work.sourceLabel,
        summary: work.summary,
        requiresDecision: work.requiresDecision,
        sourceResourceId: work.sourceResourceId,
        executionIds: [work.orchestratorTaskId],
        acceptanceStatus: work.acceptanceStatus as AiWorkItem['acceptanceStatus'],
        pullRequestUrl: work.pullRequestUrl ?? undefined,
        pullRequestNumber: work.pullRequestNumber ?? undefined,
        pullRequestState: work.pullRequestState ?? undefined,
        pullRequestMergedAt: work.pullRequestMergedAt?.toISOString(),
        worktreePath: task?.worktreePath ?? undefined,
        branchName: task?.branchName ?? undefined,
        baseCommit: task?.baseCommit ?? undefined,
        commitSha: task?.commitSha ?? undefined,
    };
}

async function buildState(accountId: string): Promise<AiTeamData> {
    const [agentRows, teamRows, conversationRows, workRows, providerMachines] = await Promise.all([
        db.aiAgent.findMany({ where: { accountId, archivedAt: null }, include: { teamMemberships: true }, orderBy: { createdAt: 'asc' } }),
        db.aiTeam.findMany({ where: { accountId, archivedAt: null }, include: { members: true }, orderBy: { createdAt: 'asc' } }),
        db.aiConversation.findMany({
            where: { accountId },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
            orderBy: { updatedAt: 'desc' },
        }),
        db.aiWorkItem.findMany({
            where: { accountId },
            include: { orchestratorRun: { include: { tasks: { include: { executions: { orderBy: { attempt: 'asc' } } } } } } },
            orderBy: { createdAt: 'desc' },
        }),
        detectProviderMachines(accountId),
    ]);
    const activeByAgent = new Map<string, WorkWithRun>();
    for (const work of workRows) {
        const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId);
        if (task && !terminalTaskStatus(task.status) && !activeByAgent.has(work.assigneeId)) activeByAgent.set(work.assigneeId, work);
    }
    const agents: AiAgent[] = agentRows.map((row) => {
        const settings = row.settings as unknown as AiAgentSettings;
        const active = activeByAgent.get(row.id);
        const hasRuntime = providerMachines.has(providerFor(settings));
        return {
            id: row.id, name: row.name, role: row.role, description: row.description, emoji: row.emoji,
            status: !row.enabled ? 'disabled' : active ? 'working' : 'idle',
            statusLabel: !row.enabled ? 'Disabled' : active ? 'Working' : 'Idle',
            skills: row.skills, responsibilities: row.responsibilities,
            teamIds: row.teamMemberships.map((membership) => membership.teamId),
            currentWorkId: active?.id ?? null, settings, enabled: row.enabled,
            availability: row.enabled && hasRuntime ? 'online' : row.enabled ? 'offline' : 'unavailable',
        };
    });
    const teams: AiTeam[] = teamRows.map((row) => {
        const teamWorks = workRows.filter((work) => work.teamId === row.id);
        const completed = teamWorks.filter((work) => projectWork(work).status === 'done').length;
        return {
            id: row.id, name: row.name, description: row.description, emoji: row.emoji,
            leaderId: row.leaderId, memberIds: row.members.map((member) => member.agentId),
            instructions: row.instructions, currentGoal: row.currentGoal,
            progress: teamWorks.length ? Math.round(completed / teamWorks.length * 100) : 0,
        };
    });
    const messages: Record<string, AiChatMessage[]> = {};
    const conversations: AiConversation[] = conversationRows.map((row) => {
        const persisted = row.messages.map((message) => ({
            timestamp: message.createdAt.getTime(),
            message: { ...(message.payload as unknown as AiChatMessage), timeLabel: timeLabel(message.createdAt) },
        }));
        const derived: Array<{ timestamp: number; message: AiChatMessage }> = [];
        for (const work of workRows.filter((item) => item.conversationId === row.id)) {
            const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId);
            if (!task || !terminalTaskStatus(task.status)) continue;
            const body = boundedOutput(task.finalResponse);
            if (!body) continue;
            const message: AiChatMessage = task.status === 'completed'
                ? { id: `result-${task.id}`, kind: 'completion', sender: 'agent', agentId: work.assigneeId, title: work.title, body, timeLabel: timeLabel(task.updatedAt) }
                : { id: `result-${task.id}`, kind: 'text', sender: 'agent', agentId: work.assigneeId, text: `Execution failed: ${body}`, timeLabel: timeLabel(task.updatedAt) };
            derived.push({ timestamp: task.updatedAt.getTime(), message });
        }
        const combined = [...persisted, ...derived]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((item) => item.message);
        messages[row.id] = combined;
        const last = combined.at(-1);
        const lastMessage = last?.kind === 'text' ? last.text : last && 'title' in last ? last.title : '';
        const team = row.teamId ? teams.find((item) => item.id === row.teamId) : undefined;
        const agent = agents.find((item) => item.id === row.agentId);
        return {
            id: row.id, kind: row.kind as 'direct' | 'group', agentId: row.agentId, teamId: row.teamId,
            title: row.title, subtitle: team ? `${team.memberIds.length} agents` : agent?.role ?? '',
            lastMessage, timeLabel: last?.timeLabel ?? timeLabel(row.updatedAt), unread: false,
            emoji: team?.emoji ?? agent?.emoji ?? '', participantAgentIds: team?.memberIds ?? [row.agentId], humanParticipantCount: 1,
        };
    });
    return {
        agents,
        teams,
        workItems: workRows.map(projectWork),
        executions: workRows.map(projectExecution),
        conversations,
        messages,
    };
}

async function assertAgents(accountId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const count = await db.aiAgent.count({ where: { accountId, archivedAt: null, id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new Error('One or more agents do not belong to this account');
}

async function lockAvailableAgentsTx(tx: Prisma.TransactionClient, accountId: string,
    ids: string[]): Promise<void> {
    for (const agentId of [...new Set(ids)].sort()) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "AiAgent" WHERE id=${agentId}
              AND "accountId"=${accountId} FOR UPDATE`;
        if (rows.length !== 1 || !await tx.aiAgent.findFirst({ where: {
            id: agentId, accountId, enabled: true, archivedAt: null,
        }, select: { id: true } })) throw new Error('Agent is unavailable');
    }
}

async function ensureConversation(accountId: string, input: { agentId: string; teamId?: string | null }) {
    await assertAgents(accountId, [input.agentId]);
    const kind = input.teamId ? 'group' : 'direct';
    if (input.teamId) {
        const team = await db.aiTeam.findFirst({ where: { id: input.teamId, accountId, archivedAt: null } });
        if (!team) throw new Error('Team not found');
        return db.aiConversation.upsert({
            where: { accountId_scopeKey: { accountId, scopeKey: `team:${input.teamId}` } },
            create: { accountId, scopeKey: `team:${input.teamId}`, kind, agentId: input.agentId, teamId: input.teamId, title: team.name },
            update: { agentId: input.agentId, title: team.name },
        });
    }
    const agent = await db.aiAgent.findFirstOrThrow({ where: { id: input.agentId, accountId, archivedAt: null } });
    return db.aiConversation.upsert({
        where: { accountId_scopeKey: { accountId, scopeKey: `agent:${input.agentId}` } },
        create: { accountId, scopeKey: `agent:${input.agentId}`, kind, agentId: input.agentId, title: agent.name },
        update: { title: agent.name },
    });
}

function buildAgentPrompt(agent: { name: string; role: string; description: string; instructions: string; responsibilities: string[]; settings: unknown }, teamContext: string | null, goal: string, requirements: string, isTeamLeader = false, deliveryPolicy?: string): string {
    const settings = agent.settings as unknown as AiAgentSettings;
    return [
        `You are ${agent.name}, ${agent.role}.`,
        agent.description,
        agent.instructions || settings.instructions,
        agent.responsibilities.length ? `Responsibilities:\n- ${agent.responsibilities.join('\n- ')}` : '',
        teamContext ? `Team context:\n${teamContext}` : '',
        `Goal:\n${goal}`,
        `Requirements and delivery criteria:\n${requirements}`,
        teamContext && isTeamLeader && settings.allowDelegation ? 'You are the team lead. Use the orchestrator skill to delegate bounded independent work to appropriate team members when that improves the result, then synthesize and verify their outputs.' : '',
        deliveryPolicy ?? '',
        'Execute the work in the configured working directory. Report concrete results, changed files, validation, and remaining risks.',
    ].filter(Boolean).join('\n\n');
}

export async function submitWork(accountId: string, input: z.infer<typeof assignmentSchema>,
    claim?: InboundClaim, clarificationId?: string,
    project?: { projectId: string; version: number; kind?: string; repositoryId: bigint | null;
        repositoryFullName: string | null; machineId: string;
        workingDirectory: string; defaultBranch: string; baseCommit: string; runOnly?: boolean },
    autopilotFence?: { autopilotRunId: string; autopilotId: string; owner: string },
    workspaceFence?: { workspaceId: string; actorAccountId: string; projectId: string;
        projectVersion: number; agentId: string }) {
    let expectedRepository: { id: string; fullName: string } | null = null;
    let sourceResourceId = input.sourceResourceId;
    if (project?.kind === 'local' && (input.sourceType === 'github' || !project.runOnly)) {
        throw new Error('Local project only supports run_only execution');
    }
    if (input.sourceType === 'github') {
        const match = input.sourceResourceId?.match(/^([^/#]+)\/([^/#]+)#([1-9]\d*)$/);
        if (!match) throw new Error('Invalid GitHub issue identity');
        const [, owner, repo, number] = match;
        const octokit = await getUserOctokit(accountId);
        const [{ data: repository }, { data: issue }] = await Promise.all([
            octokit.rest.repos.get({ owner, repo, request: { signal: AbortSignal.timeout(15_000) } }),
            octokit.rest.issues.get({ owner, repo, issue_number: Number(number),
                request: { signal: AbortSignal.timeout(15_000) } }),
        ]);
        if (!repository.permissions?.push || issue.pull_request || issue.number !== Number(number)) {
            throw new Error('GitHub issue or repository access is unavailable');
        }
        const installationId = await findAuthorizedInstallation(accountId, BigInt(repository.id));
        await db.aiGithubRepositoryGrant.upsert({
            where: { accountId_repositoryId: { accountId, repositoryId: BigInt(repository.id) } },
            create: { accountId, repositoryId: BigInt(repository.id), fullName: repository.full_name, installationId },
            update: { fullName: repository.full_name, installationId, verifiedAt: new Date() },
        });
        expectedRepository = { id: String(repository.id), fullName: repository.full_name };
        sourceResourceId = `${repository.full_name}#${number}`;
    }
    let agent = await db.aiAgent.findFirst({ where: { id: input.agentId, accountId, archivedAt: null } });
    if (!agent || !agent.enabled) throw new Error('Agent is unavailable');
    const team = input.teamId ? await db.aiTeam.findFirst({
        where: { id: input.teamId, accountId, archivedAt: null },
        include: { members: { include: { agent: true } } },
    }) : null;
    if (input.teamId && !team) throw new Error('Team not found');
    if (team) {
        const leader = team.members.find((member) => member.agentId === team.leaderId)?.agent;
        if (!leader || !leader.enabled) throw new Error('Team leader is unavailable');
        const selected = team.members.find((member) => member.agentId === input.agentId)?.agent;
        if (!selected || !selected.enabled || selected.archivedAt) throw new Error('Selected team member is unavailable');
        agent = selected;
    }
    const conversation = input.conversationId
        ? await db.aiConversation.findFirst({ where: { id: input.conversationId, accountId } })
        : await ensureConversation(accountId, { agentId: team?.leaderId ?? agent.id, teamId: team?.id });
    if (!conversation) throw new Error('Conversation not found');
    if (conversation.agentId !== (team?.leaderId ?? agent.id)
        || (conversation.teamId ?? undefined) !== (team?.id ?? undefined)) {
        throw new Error('Conversation does not match the selected agent or team');
    }
    const settings = agent.settings as unknown as AiAgentSettings;
    if (providerFor(settings) === 'gemini' && settings.permissionMode === 'read_only') {
        throw new Error('Gemini headless read_only is unavailable');
    }
    const provider = providerFor(settings);
    const targetMachineId = project?.machineId ?? (await detectProviderMachines(accountId)).get(provider);
    if (!targetMachineId) throw new Error(`No connected runtime has the ${provider} CLI installed`);
    if (settings.permissionMode === 'approval') {
        if (settings.engine !== 'codex' || settings.allowDelegation || team) {
            throw new Error('AI_APPROVAL_RUNTIME_UNSUPPORTED');
        }
        const nonce = randomUUID();
        let features: any;
        try {
            features = await invokeUserRpc(accountId, `${targetMachineId}:orchestrator-features`,
                { nonce, protocolVersion: 1 }, 3_000);
        } catch {
            throw new Error('AI_APPROVAL_RUNTIME_UNSUPPORTED');
        }
        if (features?.nonce !== nonce || features?.machineId !== targetMachineId
            || features?.protocolVersion !== 1 || features?.executionCapabilityVersion !== 1
            || features?.approval?.provider !== 'codex'
            || features?.approval?.runner !== 'app-server'
            || features?.approval?.operationDecisionVersion !== 1) {
            throw new Error('AI_APPROVAL_RUNTIME_UNSUPPORTED');
        }
    }
    if (project) {
        if (!listConnectedUserRpcMethods(accountId).includes(`${targetMachineId}:orchestrator-dispatch`)) {
            throw new Error('Project machine is not connected for dispatch');
        }
        if (expectedRepository && BigInt(expectedRepository.id) !== project.repositoryId) {
            throw new Error('GitHub issue differs from project repository');
        }
        expectedRepository = project.repositoryId && project.repositoryFullName
            ? { id: project.repositoryId.toString(), fullName: project.repositoryFullName } : null;
    }
    if (!expectedRepository && project?.kind !== 'local') {
        expectedRepository = await probeTaskRepository(accountId, targetMachineId, settings.workingDirectory);
    }
    const model = settings.model && !['default', 'runtime-default'].includes(settings.model) ? settings.model : null;
    const leaderPlan = Boolean(team && agent.id === team.leaderId);
    const teamContext = team
        ? [team.instructions, 'Members:', ...team.members.map(({ agent: member }) => `- ${member.name} (${member.role}): ${member.description}`)].join('\n')
        : null;
    // Keep the assignment path tolerant of older test doubles and deployments
    // while the conversation history table is being rolled out.
    const history = typeof db.aiMessage?.findMany === 'function'
        ? await db.aiMessage.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { sender: true, payload: true },
        })
        : [];
    const historyText = history.reverse().map((message) => {
        const payload = message.payload as { text?: string; body?: string; title?: string };
        const content = payload.text ?? payload.body ?? payload.title ?? '';
        return content ? `${message.sender}: ${content}` : '';
    }).filter(Boolean).join('\n');
    const prompt = buildAgentPrompt(
        agent,
        teamContext,
        input.title,
        historyText ? `Conversation history (continue this thread; do not lose prior decisions):\n${historyText}\n\n${input.summary}` : input.summary,
        leaderPlan,
        project?.runOnly
            ? 'Run-only automation: execute and validate in the project workspace. Do not create a GitHub Issue or pull request.'
            : input.sourceType === 'github'
            ? 'GitHub delivery: keep the linked issue updated, implement the request in a dedicated branch, run relevant validation, and create a pull request whose body contains the required closing reference (for example, `Closes #123`).'
            : 'GitHub delivery: this request came from a team conversation without a linked issue. Treat it as a software delivery request: inspect the configured repository remote, use the authenticated `gh` CLI to create a concise GitHub Issue describing the request before coding, implement the change on a dedicated branch, run validation, and create a pull request whose body contains `Closes #<new issue number>`. In your final report, include exact lines `Created GitHub issue: https://github.com/<owner>/<repo>/issues/<number>` and `Created pull request: https://github.com/<owner>/<repo>/pull/<number>` so the server can associate the delivery automatically. If no GitHub remote or authentication is available, report that blocker clearly instead of pretending the delivery is complete.',
    );
    return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AiAgent" WHERE id=${agent.id}
            AND "accountId"=${accountId} FOR UPDATE`;
        const currentAgent = await tx.aiAgent.findFirst({ where: {
            id: agent.id, accountId, archivedAt: null, enabled: true,
        }, select: { id: true } });
        if (!currentAgent) throw new Error('Agent is unavailable');
        const run = await tx.orchestratorRun.create({
            data: { accountId, title: input.title, status: 'queued', maxConcurrency: leaderPlan ? 4 : 1,
                idempotencyKey: claim ? `ai:${claim.conversationId}:${claim.clientMessageId}` : undefined,
                metadata: {
                aiRuntimeContract: WORK_ITEM_RUNTIME_CONTRACT,
                aiAgentId: agent.id, aiTeamId: team?.id ?? null, conversationId: conversation.id,
                githubRepositoryId: expectedRepository?.id ?? null,
                githubRepositoryName: expectedRepository?.fullName ?? null,
                aiProjectId: project?.projectId ?? null,
                aiProjectVersion: project?.version ?? null,
                aiProjectBaseCommit: project?.baseCommit ?? null,
                aiProjectMachineId: project?.machineId ?? null,
            } },
        });
        await reserveAiRunBudgetTx(tx, { accountId, projectId: project?.projectId, runId: run.id });
        const task = await tx.orchestratorTask.create({
            data: {
                runId: run.id, seq: 1, taskKey: 'primary', title: input.title, provider, model,
                prompt, workingDirectory: (project?.workingDirectory ?? settings.workingDirectory) || null, permissionMode: settings.permissionMode,
                targetMachineId, baseCommit: project?.baseCommit,
                assignedAgentId: agent.id, collaborationRole: leaderPlan ? 'leader_plan' : null,
                retryMaxAttempts: 2,
                retryBackoffMs: 3_000, status: 'queued', dependsOnTaskKeys: [],
            },
        });
        const deliveryTask = leaderPlan ? await tx.orchestratorTask.create({ data: {
            runId: run.id, seq: 2, taskKey: 'aggregate', title: `Integrate and review: ${input.title}`,
            provider, model, prompt: `Integrate the completed member work for ${input.title}. Review each child result and commit. Cherry-pick only explicitly identified child commits into the integration branch, stop on conflicts, run validation, and ${project?.runOnly ? 'report the local execution result without creating an Issue or pull request' : 'report one GitHub delivery'}. Do not claim success before all dependencies pass.\n\nOriginal requirements:\n${input.summary}`,
            workingDirectory: (project?.workingDirectory ?? settings.workingDirectory) || null, permissionMode: settings.permissionMode,
            targetMachineId, baseCommit: project?.baseCommit,
            assignedAgentId: agent.id, parentTaskId: task.id,
            collaborationRole: 'aggregate', dependsOnTaskKeys: ['primary'],
            retryMaxAttempts: 2, retryBackoffMs: 3_000, status: 'queued',
        } }) : task;
        const skillBindings = await tx.aiSkillAgentBinding.findMany({ where: { accountId,
            agentId: agent.id, skill: { OR: [{ teamId: null }, { teamId: team?.id ?? '__no_team__' }],
                currentVersion: { not: null } } }, include: { skill: true } });
        for (const binding of skillBindings) {
            const version = await tx.aiSkillVersion.findUnique({ where: { skillId_version: {
                skillId: binding.skillId, version: binding.skill.currentVersion!,
            } }, select: { contentHash: true, publishedAt: true } });
            if (!version?.publishedAt) continue;
            await tx.aiTaskSkillSnapshot.createMany({ data: [...new Set([task.id, deliveryTask.id])].map((taskId) => ({
                taskId, skillId: binding.skillId, version: binding.skill.currentVersion!,
                contentHash: version.contentHash,
            })) });
        }
        const work = await tx.aiWorkItem.create({
            data: {
                accountId, title: input.title, summary: input.summary,
                sourceType: input.sourceType, sourceLabel: input.sourceLabel,
                sourceResourceId: sourceResourceId ?? task.id,
                projectId: project?.projectId, projectVersion: project?.version,
                assigneeId: agent.id, teamId: team?.id, conversationId: conversation.id,
                orchestratorRunId: run.id, orchestratorTaskId: deliveryTask.id,
            },
        });
        const payload: AiChatMessage = { id: `message-${work.id}`, kind: 'text', sender: 'user', text: input.summary, timeLabel: new Date().toISOString() };
        await tx.aiMessage.create({ data: { conversationId: conversation.id, clientMessageId: claim?.clientMessageId, sender: 'user', payload: payload as Prisma.InputJsonValue } });
        await tx.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
        if (autopilotFence) {
            const fenced = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT r.id FROM "AiAutopilotRun" r
                JOIN "AiAutopilot" a ON a.id = r."autopilotId"
                WHERE r.id = ${autopilotFence.autopilotRunId}
                  AND r."autopilotId" = ${autopilotFence.autopilotId}
                  AND r."claimOwner" = ${autopilotFence.owner}
                  AND r.status = 'processing' AND r."leaseUntil" > clock_timestamp()
                  AND a."accountId" = ${accountId} AND a.enabled = true
                FOR UPDATE OF r`;
            if (fenced.length !== 1) throw new Error('Autopilot lease owner changed');
        }
        if (workspaceFence) {
            const locked = await tx.$queryRaw<Array<{ ownerAccountId: string }>>`
                SELECT "ownerAccountId" FROM "AiWorkspace"
                WHERE id=${workspaceFence.workspaceId} FOR UPDATE`;
            if (locked[0]?.ownerAccountId !== accountId) {
                throw new Error('Workspace ownership changed');
            }
            const membership = await tx.aiWorkspaceMembership.findUnique({ where: {
                workspaceId_memberAccountId: { workspaceId: workspaceFence.workspaceId,
                    memberAccountId: workspaceFence.actorAccountId },
            } });
            if (!membership) throw new Error('Workspace membership revoked');
            if (!['owner', 'admin'].includes(membership.role)) {
                const grants = await tx.aiWorkspaceGrant.findMany({ where: {
                    workspaceId: workspaceFence.workspaceId,
                    memberAccountId: workspaceFence.actorAccountId,
                    canRun: true, canView: true,
                    OR: [{ resourceKind: 'project', resourceId: workspaceFence.projectId },
                        { resourceKind: 'agent', resourceId: workspaceFence.agentId }],
                } });
                if (!grants.some((grant) => grant.resourceKind === 'project')
                    || !grants.some((grant) => grant.resourceKind === 'agent')) {
                    throw new Error('Workspace run grant revoked');
                }
            }
            const [currentProject, currentAgent] = await Promise.all([
                tx.$queryRaw<Array<{ id: string }>>`
                    SELECT id FROM "AiProject" WHERE id=${workspaceFence.projectId}
                      AND "accountId"=${accountId} AND active=true
                      AND "currentVersion"=${workspaceFence.projectVersion} FOR SHARE`,
                tx.$queryRaw<Array<{ id: string }>>`
                    SELECT id FROM "AiAgent" WHERE id=${workspaceFence.agentId}
                      AND "accountId"=${accountId} AND enabled=true
                      AND "archivedAt" IS NULL FOR SHARE`,
            ]);
            if (currentProject.length !== 1 || currentAgent.length !== 1) {
                throw new Error('Project or agent changed');
            }
        }
        if (clarificationId) {
            const resolved = await tx.aiClarification.updateMany({ where: { id: clarificationId,
                accountId, conversationId: conversation.id, status: 'pending' },
                data: { status: 'resolved', resolvedText: input.summary, resolvedAt: new Date() } });
            if (!resolved.count) throw new Error('Clarification was already resolved');
        }
        const response = { workItemId: work.id, executionId: task.id,
            aggregateTaskId: leaderPlan ? deliveryTask.id : undefined, conversationId: conversation.id, runId: run.id };
        if (claim) {
            const completed = await tx.aiInboundRequest.updateMany({ where: { ...claim, status: 'processing' },
                data: { status: 'completed', response, claimOwner: null, leaseUntil: null } });
            if (!completed.count) throw new Error('Inbound claim expired');
        }
        return response;
    });
}

/** Queue a conversational turn for the selected agent without creating a
 * durable delivery WorkItem. The scheduler/runtime still execute it, and the
 * finish callback writes the agent's answer back into the conversation. */
async function submitCoordinatorChat(accountId: string, conversation: { id: string; agentId: string; teamId: string | null }, text: string, claim: InboundClaim) {
    let agent = await db.aiAgent.findFirst({ where: { id: conversation.agentId, accountId, archivedAt: null } });
    if (!agent || !agent.enabled) throw new Error('Agent is unavailable');
    const team = conversation.teamId ? await db.aiTeam.findFirst({
        where: { id: conversation.teamId, accountId, archivedAt: null },
        include: { members: { include: { agent: true } } },
    }) : null;
    if (conversation.teamId && !team) throw new Error('Team not found');
    if (team) {
        const leader = team.members.find((member) => member.agentId === team.leaderId)?.agent;
        if (!leader || !leader.enabled) throw new Error('Team leader is unavailable');
        agent = leader;
    }
    const settings = agent.settings as unknown as AiAgentSettings;
    const provider = providerFor(settings);
    if (provider === 'gemini') throw new Error('Gemini cannot guarantee headless read_only coordinator chat');
    const targetMachineId = (await detectProviderMachines(accountId)).get(provider);
    if (!targetMachineId) throw new Error(`No connected runtime has the ${provider} CLI installed`);
    const prompt = [
        `You are ${agent.name}, the conversational coordinator.`,
        agent.description,
        agent.instructions || settings.instructions,
        `Answer the user's message naturally and concisely. Do not create a work item, edit files, or claim that work was completed. If the user describes a software delivery request, explain that it can be turned into a tracked task in a follow-up turn.`,
        `User message:\n${text}`,
    ].filter(Boolean).join('\n\n');
    const payload: AiChatMessage = { id: `message-${randomUUID()}`, kind: 'text', sender: 'user', text, timeLabel: new Date().toISOString() };
    return db.$transaction(async (tx) => {
        const run = await tx.orchestratorRun.create({
            data: {
                accountId, title: `Chat: ${text.split(/\r?\n/, 1)[0].slice(0, 120)}`, status: 'queued', maxConcurrency: 1,
                metadata: { coordinatorChat: true, aiRuntimeContract: COORDINATOR_RUNTIME_CONTRACT,
                    conversationId: conversation.id, aiAgentId: agent.id },
            },
        });
        const task = await tx.orchestratorTask.create({
            data: {
                runId: run.id, seq: 1, taskKey: 'coordinator-chat', title: 'Coordinator reply', provider,
                model: settings.model && !['default', 'runtime-default'].includes(settings.model) ? settings.model : null,
                prompt, workingDirectory: settings.workingDirectory || null, permissionMode: 'read_only',
                targetMachineId, retryMaxAttempts: 1, retryBackoffMs: 0, status: 'queued', dependsOnTaskKeys: [],
            },
        });
        await tx.aiMessage.create({ data: { id: payload.id, conversationId: conversation.id, clientMessageId: claim.clientMessageId, sender: 'user', payload: payload as Prisma.InputJsonValue } });
        await tx.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
        const response = { kind: 'chat' as const, conversationId: conversation.id, messageId: payload.id, runId: run.id, executionId: task.id };
        const completed = await tx.aiInboundRequest.updateMany({ where: { ...claim, status: 'processing' },
            data: { status: 'completed', response, claimOwner: null, leaseUntil: null } });
        if (!completed.count) throw new Error('Inbound claim expired');
        return response;
    });
}

async function persistClarification(accountId: string, conversationId: string, text: string,
    question: string, claim: InboundClaim, candidates?: Array<{ id: string; name: string }>,
    targetWorkItemId?: string, options: string[] = []) {
    return db.$transaction(async (tx) => {
        const clarification = await tx.aiClarification.create({ data: {
            accountId, conversationId, clientMessageId: claim.clientMessageId,
            originalText: text, question, options, candidates: candidates ?? undefined, targetWorkItemId,
        } });
        const userPayload: AiChatMessage = { id: `message-${randomUUID()}`, kind: 'text', sender: 'user',
            text, timeLabel: new Date().toISOString() };
        const agentPayload: AiChatMessage = { id: `clarification-${clarification.id}`, kind: 'text', sender: 'agent',
            text: question, timeLabel: new Date().toISOString() };
        await tx.aiMessage.create({ data: { id: userPayload.id, conversationId,
            clientMessageId: claim.clientMessageId, sender: 'user', payload: userPayload as Prisma.InputJsonValue } });
        await tx.aiMessage.create({ data: { id: agentPayload.id, conversationId,
            sender: 'agent', payload: agentPayload as Prisma.InputJsonValue } });
        const response = { kind: 'clarify' as const, clarificationId: clarification.id,
            conversationId, question, options, candidates: candidates ?? [],
            targetWorkItemId: targetWorkItemId ?? null };
        const completed = await tx.aiInboundRequest.updateMany({ where: { ...claim, status: 'processing' },
            data: { status: 'completed', response, claimOwner: null, leaseUntil: null } });
        if (!completed.count) throw new Error('Inbound claim expired');
        return response;
    });
}

async function resumeAiWork(accountId: string, conversationId: string, workItemId: string,
    text: string, claim: InboundClaim, clarificationId?: string,
    acceptanceRevision = false, actorAccountId = accountId) {
    return db.$transaction(async (tx) => {
        if (actorAccountId !== accountId && (!await authorizeWorkItemTx(tx, {
            actorAccountId, workItemId, operation: 'approve',
        }) || !await authorizeWorkItemTx(tx, { actorAccountId, workItemId,
            operation: 'run' }))) throw new Error('Workspace approval permission was revoked');
        await tx.$queryRaw`SELECT id FROM "AiWorkItem" WHERE id=${workItemId} FOR UPDATE`;
        const work = await tx.aiWorkItem.findFirst({ where: { id: workItemId, accountId, conversationId } });
        if (!work) throw new Error('Target work item not found');
        await tx.$queryRaw`SELECT id FROM "OrchestratorTask"
            WHERE id=${work.orchestratorTaskId} FOR UPDATE`;
        const task = await tx.orchestratorTask.findFirst({ where: { id: work.orchestratorTaskId,
            run: { accountId } } });
        if (!task || !['completed', 'failed'].includes(task.status)) throw new Error('Target task is not resumable');
        if (isApprovalTerminalFailure(task.errorCode)) {
            throw new Error('Approval outcome requires a separately reviewed new task');
        }
        const source = await tx.orchestratorExecution.findFirst({ where: {
            taskId: task.id, childSessionId: { not: null },
        }, orderBy: { attempt: 'desc' } });
        if (!source?.childSessionId || (task.targetMachineId && source.machineId !== task.targetMachineId)
            || (task.workingDirectory && (!source.worktreePath || !source.branchName || !source.baseCommit
                || task.branchName !== source.branchName || task.baseCommit !== source.baseCommit))) {
            throw new Error('Target workspace identity is unavailable');
        }
        const latest = await tx.orchestratorExecution.findFirst({ where: { taskId: task.id },
            orderBy: { attempt: 'desc' }, select: { attempt: true } });
        const moved = await tx.orchestratorTask.updateMany({ where: { id: task.id,
            status: { in: ['completed', 'failed'] } }, data: { status: 'queued', nextAttemptAt: null,
                errorCode: null, errorMessage: null } });
        if (!moved.count) throw new Error('Target task changed; retry');
        const execution = await tx.orchestratorExecution.create({ data: {
            runId: task.runId, taskId: task.id, machineId: source.machineId,
            provider: task.provider, model: task.model, childSessionId: source.childSessionId,
            executionType: 'resume', resumeMessage: text, status: 'queued',
            attempt: (latest?.attempt ?? 0) + 1, dispatchToken: randomUUID(), timeoutMs: task.timeoutMs,
        } });
        await tx.orchestratorRun.update({ where: { id: task.runId }, data: {
            status: 'running', completedAt: null,
        } });
        if (acceptanceRevision) {
            await tx.aiWorkItem.update({ where: { id: work.id }, data: {
                acceptanceStatus: 'changes_requested', requiresDecision: false,
                deliveryVerificationStatus: 'pending', deliveryVerifiedAt: null,
            } });
            await tx.aiWorkItemAudit.create({ data: { workItemId: work.id,
                actorAccountId, action: 'changes_requested',
                before: { acceptanceStatus: work.acceptanceStatus },
                after: { acceptanceStatus: 'changes_requested', executionId: execution.id },
            } });
        }
        const payload: AiChatMessage = { id: `message-${randomUUID()}`, kind: 'text', sender: 'user',
            text, timeLabel: new Date().toISOString() };
        await tx.aiMessage.create({ data: { id: payload.id, conversationId,
            clientMessageId: claim.clientMessageId, sender: 'user',
            payload: { ...payload, actorAccountId } as Prisma.InputJsonValue } });
        if (clarificationId) {
            const resolved = await tx.aiClarification.updateMany({ where: { id: clarificationId,
                accountId, conversationId, status: 'pending' }, data: {
                status: 'resolved', resolvedText: text, resolvedAt: new Date(),
            } });
            if (!resolved.count) throw new Error('Clarification was already resolved');
        }
        const response = { kind: 'update_task' as const, targetWorkItemId: work.id,
            conversationId, runId: task.runId, executionId: execution.id };
        const completed = await tx.aiInboundRequest.updateMany({ where: { ...claim, status: 'processing' },
            data: { status: 'completed', response, claimOwner: null, leaseUntil: null } });
        if (!completed.count) throw new Error('Inbound claim expired');
        return response;
    });
}

async function queueAiSteering(accountId: string, conversationId: string, workItemId: string,
    targetTaskId: string | undefined, text: string, claim: InboundClaim) {
    return db.$transaction(async (tx) => {
        const work = await tx.aiWorkItem.findFirst({ where: { id: workItemId, accountId, conversationId } });
        if (!work) throw new Error('Target work item not found');
        const running = await tx.orchestratorExecution.findMany({ where: {
            runId: work.orchestratorRunId, status: 'running',
            ...(targetTaskId ? { taskId: targetTaskId } : {}),
        }, take: 2, select: { taskId: true } });
        if (running.length !== 1) throw new Error(running.length ? 'Select one active task to steer' : 'No active task to steer');
        const steering = await tx.aiSteeringMessage.create({ data: {
            accountId, actorAccountId: accountId, conversationId, workItemId: work.id,
            targetTaskId: running[0].taskId,
            clientMessageId: claim.clientMessageId, text,
        } });
        const payload: AiChatMessage = { id: `message-${randomUUID()}`, kind: 'text', sender: 'user',
            text, timeLabel: new Date().toISOString() };
        await tx.aiMessage.create({ data: { id: payload.id, conversationId,
            clientMessageId: claim.clientMessageId, sender: 'user', payload: payload as Prisma.InputJsonValue } });
        const response = { kind: 'update_task' as const, targetWorkItemId: work.id,
            targetTaskId: running[0].taskId, steeringId: steering.id, status: 'queued' as const };
        const completed = await tx.aiInboundRequest.updateMany({ where: { ...claim, status: 'processing' },
            data: { status: 'completed', response, claimOwner: null, leaseUntil: null } });
        if (!completed.count) throw new Error('Inbound claim expired');
        return response;
    });
}

export function aiTeamRoutes(app: Fastify) {
    aiDelegationRoutes(app);
    aiProjectRoutes(app);
    aiSkillRoutes(app);
    aiAutopilotRoutes(app);
    aiWorkspaceRoutes(app);
    aiExecutionEventRoutes(app);
    aiBudgetRoutes(app);
    aiDecisionRoutes(app);
    aiWorkItemCollaborationRoutes(app);
    aiAgentTemplateRoutes(app);
    app.post('/v1/ai-team/workspaces/:workspaceId/projects/:projectId/run', {
        preHandler: app.authenticate,
        schema: { params: z.object({ workspaceId: z.string().min(1),
            projectId: z.string().min(1) }), body: z.object({
            clientRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
            agentId: z.string().min(1), title: z.string().trim().min(1).max(256),
            summary: z.string().trim().min(1).max(65_536),
        }).strict() },
    }, async (request, reply) => {
        const { workspaceId, projectId } = request.params;
        const projectAccess = await authorizeWorkspace(request.userId, workspaceId,
            'run', { kind: 'project', id: projectId });
        const agentAccess = await authorizeWorkspace(request.userId, workspaceId,
            'run', { kind: 'agent', id: request.body.agentId });
        if (!projectAccess || !agentAccess) return reply.code(404).send({ error: 'Workspace resource not found' });
        const owner = projectAccess.ownerAccountId;
        const [project, agent] = await Promise.all([
            db.aiProject.findFirst({ where: { id: projectId, accountId: owner,
                active: true }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } }),
            db.aiAgent.findFirst({ where: { id: request.body.agentId,
                accountId: owner, enabled: true, archivedAt: null }, select: { id: true } }),
        ]);
        const version = project?.versions[0];
        if (!project || !version || version.version !== project.currentVersion || !agent) {
            return reply.code(404).send({ error: 'Project or agent not found' });
        }
        const conversation = await ensureConversation(owner, { agentId: agent.id });
        const clientMessageId = `workspace:${request.userId}:${request.body.clientRequestId}`;
        const claim = await claimInbound({ accountId: owner, conversationId: conversation.id,
            clientMessageId }, { kind: 'workspace_run', workspaceId, projectId,
            projectVersion: version.version, actorAccountId: request.userId,
            agentId: agent.id, title: request.body.title, summary: request.body.summary });
        if (claim.kind === 'completed') return reply.send(claim.response);
        if (claim.kind !== 'claimed') return reply.code(409).send({ error: 'Workspace run request conflict' });
        try {
            const response = await submitWork(owner, { agentId: agent.id,
                conversationId: conversation.id, clientMessageId,
                title: request.body.title, summary: request.body.summary,
                sourceType: 'execution', sourceLabel: 'Workspace run',
                sourceResourceId: `workspace:${workspaceId}:${request.userId}`,
            }, claim.claim, undefined, { projectId, version: version.version,
                kind: version.kind, repositoryId: version.repositoryId,
                repositoryFullName: version.repositoryFullName, machineId: version.machineId,
                workingDirectory: version.workingDirectory,
                defaultBranch: version.defaultBranch, baseCommit: version.baseCommit,
                runOnly: true }, undefined, { workspaceId,
                actorAccountId: request.userId, projectId,
                projectVersion: version.version, agentId: agent.id });
            return reply.code(201).send(response);
        } catch (error) {
            await failInbound(claim.claim);
            return reply.code(409).send({ error: error instanceof Error
                ? error.message : 'Workspace run unavailable' });
        }
    });
    app.get('/v1/ai-team/state', { preHandler: app.authenticate }, async (request, reply) => {
        return reply.send(await buildState(request.userId));
    });

    app.get('/v1/ai-team/agents/archived', { preHandler: app.authenticate,
        schema: { querystring: z.object({ cursor: z.string().min(1).max(200).optional(),
            limit: z.coerce.number().int().min(1).max(100).optional() }) },
    }, async (request, reply) => {
        const limit = request.query.limit ?? 50;
        if (request.query.cursor && !await db.aiAgent.findFirst({ where: {
            id: request.query.cursor, accountId: request.userId,
            archivedAt: { not: null } }, select: { id: true } })) {
            return reply.code(400).send({ errorCode: 'INVALID_CURSOR' });
        }
        const rows = await db.aiAgent.findMany({ where: { accountId: request.userId,
            archivedAt: { not: null } },
        orderBy: [{ archivedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
        ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}),
        select: { id: true, name: true, role: true, archivedAt: true, enabled: true } });
        return reply.send({ items: rows.slice(0, limit),
            nextCursor: rows.length > limit ? rows[limit - 1]?.id ?? null : null });
    });

    app.post('/v1/ai-team/agents', { preHandler: app.authenticate, schema: { body: agentInputSchema } }, async (request, reply) => {
        const input = request.body;
        const row = await db.aiAgent.create({ data: {
            accountId: request.userId, name: input.name, role: input.role, description: input.description,
            emoji: input.emoji, instructions: input.settings.instructions, skills: input.skills,
            responsibilities: input.responsibilities, settings: input.settings as Prisma.InputJsonValue, enabled: input.enabled,
        } });
        return reply.code(201).send({ id: row.id });
    });

    app.post('/v1/ai-team/agents/generate', { preHandler: app.authenticate, schema: { body: agentGenerationSchema } }, async (request, reply) => {
        try {
            return reply.send(await generateAgentDraft(request.userId, request.body.prompt));
        } catch (error) {
            return reply.code(503).send({ error: error instanceof Error ? error.message : 'AI generation unavailable' });
        }
    });

    app.put('/v1/ai-team/agents/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }), body: agentInputSchema } }, async (request, reply) => {
        const current = await db.aiAgent.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null } });
        if (!current) return reply.code(404).send({ error: 'Agent not found' });
        const input = request.body;
        const updated = await db.aiAgent.updateMany({ where: { id: current.id,
            accountId: request.userId, archivedAt: null }, data: {
            name: input.name, role: input.role, description: input.description, emoji: input.emoji,
            instructions: input.settings.instructions, skills: input.skills, responsibilities: input.responsibilities,
            settings: input.settings as Prisma.InputJsonValue, enabled: input.enabled,
            templateVersionId: null,
        } });
        if (!updated.count) return reply.code(404).send({ error: 'Agent not found' });
        return reply.send({ ok: true });
    });

    app.post('/v1/ai-team/agents/:id/duplicate', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const source = await db.aiAgent.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null } });
        if (!source) return reply.code(404).send({ error: 'Agent not found' });
        const row = await db.aiAgent.create({ data: {
            accountId: request.userId, name: `${source.name} Copy ${Date.now().toString(36)}`, role: source.role,
            description: source.description, emoji: source.emoji, instructions: source.instructions,
            skills: source.skills, responsibilities: source.responsibilities, settings: source.settings, enabled: source.enabled,
        } });
        return reply.code(201).send({ id: row.id });
    });

    app.delete('/v1/ai-team/agents/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const result = await db.$transaction(async tx => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM "AiAgent" WHERE id=${request.params.id}
                  AND "accountId"=${request.userId} AND "archivedAt" IS NULL
                FOR UPDATE`;
            if (!locked.length) return 'missing' as const;
            const ledTeams = await tx.aiTeam.count({ where: {
                accountId: request.userId, leaderId: request.params.id,
                archivedAt: null,
            } });
            if (ledTeams) return 'leader' as const;
            const activeWorks = await tx.aiWorkItem.count({ where: {
                accountId: request.userId, assigneeId: request.params.id,
                orchestratorRun: { status: { in: ['queued', 'running', 'canceling'] } },
            } });
            const activeTasks = await tx.orchestratorTask.count({ where: {
                assignedAgentId: request.params.id,
                status: { in: ['queued', 'dispatching', 'running'] },
                run: { accountId: request.userId },
            } });
            if (activeWorks || activeTasks) return 'active' as const;
            await tx.aiAgent.update({ where: { id: request.params.id }, data: {
                archivedAt: new Date(), enabled: false,
            } });
            return 'archived' as const;
        });
        if (result === 'missing') return reply.code(404).send({ error: 'Agent not found' });
        if (result === 'leader') return reply.code(409).send({ error: 'Assign another team leader before deleting this agent' });
        if (result === 'active') return reply.code(409).send({ error: 'Agent has active work; cancel or finish it before archiving' });
        return reply.code(204).send();
    });

    app.post('/v1/ai-team/agents/:id/restore', { preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) },
    }, async (request, reply) => {
        const restored = await db.aiAgent.updateMany({ where: {
            id: request.params.id, accountId: request.userId,
            archivedAt: { not: null },
        }, data: { archivedAt: null, enabled: false } });
        if (restored.count) return reply.send({ id: request.params.id,
            archived: false, enabled: false, duplicate: false });
        const active = await db.aiAgent.findFirst({ where: {
            id: request.params.id, accountId: request.userId, archivedAt: null,
        }, select: { id: true, enabled: true } });
        if (!active) return reply.code(404).send({ error: 'Agent not found' });
        return reply.send({ id: active.id, archived: false,
            enabled: active.enabled, duplicate: true });
    });

    app.post('/v1/ai-team/teams', { preHandler: app.authenticate, schema: { body: teamInputSchema } }, async (request, reply) => {
        const input = request.body;
        const memberIds = [...new Set([input.leaderId, ...input.memberIds])];
        await assertAgents(request.userId, memberIds);
        let row;
        try { row = await db.$transaction(async tx => {
            await lockAvailableAgentsTx(tx, request.userId, memberIds);
            return tx.aiTeam.create({ data: {
            accountId: request.userId, name: input.name, description: input.description, emoji: input.emoji,
            instructions: input.instructions, currentGoal: input.currentGoal, leaderId: input.leaderId,
            members: { create: memberIds.map((agentId) => ({ agentId })) },
            } });
        }); } catch { return reply.code(409).send({ error: 'Agent is unavailable' }); }
        return reply.code(201).send({ id: row.id });
    });

    app.put('/v1/ai-team/teams/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }), body: teamInputSchema } }, async (request, reply) => {
        const team = await db.aiTeam.findFirst({ where: { id: request.params.id, accountId: request.userId, archivedAt: null } });
        if (!team) return reply.code(404).send({ error: 'Team not found' });
        const input = request.body;
        const memberIds = [...new Set([input.leaderId, ...input.memberIds])];
        await assertAgents(request.userId, memberIds);
        try { await db.$transaction(async (tx) => {
            await lockAvailableAgentsTx(tx, request.userId, memberIds);
            await tx.aiTeamMember.deleteMany({ where: { teamId: team.id } });
            await tx.aiTeam.update({ where: { id: team.id }, data: {
                name: input.name, description: input.description, emoji: input.emoji,
                instructions: input.instructions, currentGoal: input.currentGoal, leaderId: input.leaderId,
                members: { create: memberIds.map((agentId) => ({ agentId })) },
            } });
        }); } catch { return reply.code(409).send({ error: 'Agent is unavailable' }); }
        return reply.send({ ok: true });
    });

    app.delete('/v1/ai-team/teams/:id', { preHandler: app.authenticate, schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const result = await db.aiTeam.updateMany({ where: { id: request.params.id, accountId: request.userId, archivedAt: null }, data: { archivedAt: new Date() } });
        if (!result.count) return reply.code(404).send({ error: 'Team not found' });
        return reply.code(204).send();
    });

    app.post('/v1/ai-team/conversations', {
        preHandler: app.authenticate,
        schema: { body: z.object({ agentId: z.string(), teamId: z.string().nullable().optional() }) },
    }, async (request, reply) => {
        const conversation = await ensureConversation(request.userId, request.body);
        return reply.send({ id: conversation.id });
    });

    app.get('/v1/ai-team/conversations/:id/clarifications', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }),
            querystring: z.object({ status: z.literal('pending').optional() }) },
    }, async (request, reply) => {
        const conversation = await db.aiConversation.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, select: { id: true } });
        if (!conversation) return reply.code(404).send({ error: 'Conversation not found' });
        const rows = await db.aiClarification.findMany({ where: { accountId: request.userId,
            conversationId: conversation.id, status: 'pending' },
            orderBy: { createdAt: 'desc' }, take: 20,
            select: { id: true, clientMessageId: true, originalText: true, question: true, options: true,
                candidates: true, targetWorkItemId: true, createdAt: true } });
        return reply.send({ items: rows });
    });

    app.post('/v1/ai-team/assignments', { preHandler: app.authenticate, schema: { body: assignmentSchema } }, async (request, reply) => {
        const input = request.body;
        if (!input.clientMessageId) return reply.code(400).send({ error: 'clientMessageId is required' });
        const team = input.teamId ? await db.aiTeam.findFirst({ where: { id: input.teamId, accountId: request.userId } }) : null;
        if (input.teamId && !team) return reply.code(404).send({ error: 'Team not found' });
        const conversationId = input.conversationId ?? (await ensureConversation(request.userId, { agentId: team?.leaderId ?? input.agentId, teamId: input.teamId })).id;
        const claimResult = await claimInbound({ accountId: request.userId, conversationId, clientMessageId: input.clientMessageId }, input);
        if (claimResult.kind === 'completed') return reply.code(201).send(claimResult.response);
        if (claimResult.kind === 'conflict') return reply.code(409).send({ error: 'Client message id was reused with different content' });
        if (claimResult.kind === 'processing') return reply.code(503).send({ error: 'Request is processing; retry' });
        try {
            return reply.code(201).send(await submitWork(request.userId, { ...input, conversationId }, claimResult.claim));
        } catch (error) {
            await failInbound(claimResult.claim);
            return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to create assignment' });
        }
    });

    app.post('/v1/ai-team/conversations/:id/messages', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: messageSchema },
    }, async (request, reply) => {
        const conversation = await db.aiConversation.findFirst({ where: { id: request.params.id, accountId: request.userId } });
        if (!conversation) return reply.code(404).send({ error: 'Conversation not found' });
        const claimResult = await claimInbound({ accountId: request.userId, conversationId: conversation.id,
            clientMessageId: request.body.clientMessageId }, request.body);
        if (claimResult.kind === 'completed') return reply.send(claimResult.response);
        if (claimResult.kind === 'conflict') return reply.code(409).send({ error: 'Client message id was reused with different content' });
        if (claimResult.kind === 'processing') return reply.code(503).send({ error: 'Request is processing; retry' });
        let text = request.body.text;
        let clarificationId: string | undefined;
        let targetWorkItemId = request.body.targetWorkItemId;
        let selectedClarificationAgentId = request.body.assigneeId;
        if (request.body.clarificationId) {
            const clarification = await db.aiClarification.findFirst({ where: {
                id: request.body.clarificationId, accountId: request.userId,
                conversationId: conversation.id, status: 'pending',
            } });
            if (!clarification) {
                await failInbound(claimResult.claim);
                return reply.code(409).send({ error: 'Clarification is unavailable or already resolved' });
            }
            clarificationId = clarification.id;
            const candidates = Array.isArray(clarification.candidates)
                ? clarification.candidates.filter((item): item is { id: string; name: string } =>
                    !!item && typeof item === 'object' && !Array.isArray(item)
                    && typeof item.id === 'string' && typeof item.name === 'string') : [];
            if (clarification.targetWorkItemId) {
                if (targetWorkItemId && targetWorkItemId !== clarification.targetWorkItemId) {
                    await failInbound(claimResult.claim);
                    return reply.code(409).send({ error: 'Clarification target changed' });
                }
                targetWorkItemId = clarification.targetWorkItemId;
            } else if (candidates.length) {
                const selected = candidates.find((item) => item.id === targetWorkItemId
                    || item.id === selectedClarificationAgentId
                    || item.id === request.body.text.trim()
                    || item.name.toLowerCase() === request.body.text.trim().toLowerCase());
                if (!selected) {
                    await failInbound(claimResult.claim);
                    return reply.code(409).send({ error: 'Choose a saved clarification candidate' });
                }
                const work = await db.aiWorkItem.findFirst({ where: { id: selected.id,
                    accountId: request.userId, conversationId: conversation.id }, select: { id: true } });
                if (work) targetWorkItemId = work.id;
                else selectedClarificationAgentId = selected.id;
            }
            text = `${clarification.originalText}\n\nClarification answer:\n${text}`;
        }
        if (request.body.mode === 'new' && targetWorkItemId) {
            await failInbound(claimResult.claim);
            return reply.code(409).send({ error: 'New work cannot target an existing work item' });
        }
        if (targetWorkItemId) {
            const target = await db.aiWorkItem.findFirst({ where: { id: targetWorkItemId,
                accountId: request.userId, conversationId: conversation.id } });
            if (!target) {
                await failInbound(claimResult.claim);
                return reply.code(404).send({ error: 'Target work item not found in this conversation' });
            }
        }
        if (request.body.mode === 'continue' && !targetWorkItemId && !clarificationId) {
            try {
                const candidates = await db.aiWorkItem.findMany({ where: { accountId: request.userId,
                    conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 8,
                    select: { id: true, title: true } });
                return reply.send(await persistClarification(request.userId, conversation.id, text,
                    '请选择要继续的任务。', claimResult.claim,
                    candidates.map((item) => ({ id: item.id, name: item.title }))));
            } catch (error) {
                await failInbound(claimResult.claim);
                return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to select target' });
            }
        }
        if (request.body.mode === 'steer') {
            if (!targetWorkItemId) {
                await failInbound(claimResult.claim);
                return reply.code(409).send({ error: 'Running-task steering requires targetWorkItemId' });
            }
            try {
                return reply.code(202).send(await queueAiSteering(request.userId, conversation.id,
                    targetWorkItemId, request.body.targetTaskId, text, claimResult.claim));
            } catch (error) {
                await failInbound(claimResult.claim);
                return reply.code(409).send({ error: error instanceof Error ? error.message : 'Unable to queue steering' });
            }
        }
        if (targetWorkItemId) {
            try {
                return reply.send(await resumeAiWork(request.userId, conversation.id,
                    targetWorkItemId, text, claimResult.claim, clarificationId));
            } catch (error) {
                await failInbound(claimResult.claim);
                return reply.code(409).send({ error: error instanceof Error ? error.message : 'Unable to resume task' });
            }
        }
        let selectedAgentId = selectedClarificationAgentId ?? conversation.agentId;
        const mention = text.match(/(?:^|\s)@([A-Za-z0-9_.-]{1,100})\b/);
        if (mention && !request.body.assigneeId) {
            const agents = conversation.teamId
                ? (await db.aiTeamMember.findMany({ where: { teamId: conversation.teamId,
                    agent: { accountId: request.userId, enabled: true, archivedAt: null } },
                    include: { agent: { select: { id: true, name: true } } },
                })).map((member) => member.agent)
                : await db.aiAgent.findMany({ where: { id: conversation.agentId,
                    accountId: request.userId, enabled: true, archivedAt: null }, select: { id: true, name: true } });
            const matches = agents.filter((agent) => agent.name.toLowerCase() === mention[1].toLowerCase());
            if (matches.length !== 1) {
                try {
                    return reply.send(await persistClarification(request.userId, conversation.id, text,
                        '请选择负责此任务的成员。', claimResult.claim,
                        matches.map((agent) => ({ id: agent.id, name: agent.name }))));
                } catch (error) {
                    await failInbound(claimResult.claim);
                    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to select member' });
                }
            }
            selectedAgentId = matches[0].id;
        }
        if (selectedAgentId !== conversation.agentId) {
            const member = conversation.teamId ? await db.aiTeamMember.findFirst({ where: {
                teamId: conversation.teamId, agentId: selectedAgentId,
                agent: { accountId: request.userId, enabled: true, archivedAt: null },
            } }) : null;
            if (!member) {
                await failInbound(claimResult.claim);
                return reply.code(403).send({ error: 'Selected agent is not an enabled member of this team' });
            }
        }
        const decision = clarificationId ? { intent: 'create_task' as const, question: undefined }
            : await decideCoordinatorMessage(request.userId, conversation,
                request.body.clientMessageId, text).catch(async () => {
                const fallback = await classifyCoordinatorMessageWithModel(text, request.userId, conversation.id);
                return { intent: fallback.intent === 'task' ? 'create_task' as const : fallback.intent,
                    question: fallback.question };
            });
        const intent = decision.intent;
        if (intent === 'update_task') {
            const target = await db.aiWorkItem.findFirst({ where: { id: decision.targetWorkItemId,
                accountId: request.userId, conversationId: conversation.id }, select: { id: true } });
            if (!target) {
                await failInbound(claimResult.claim);
                return reply.code(409).send({ error: 'Coordinator target is unavailable' });
            }
            try {
                return reply.send(await resumeAiWork(request.userId, conversation.id,
                    target.id, decision.requirements, claimResult.claim));
            } catch (error) {
                await failInbound(claimResult.claim);
                return reply.code(409).send({ error: error instanceof Error ? error.message : 'Unable to update task' });
            }
        }
        if (intent === 'delegate') {
            await failInbound(claimResult.claim);
            return reply.code(409).send({ error: 'Delegation requires an active Leader execution token' });
        }
        if (intent === 'create_task' && 'assigneeId' in decision && decision.assigneeId) {
            selectedAgentId = decision.assigneeId;
            const authorized = selectedAgentId === conversation.agentId || !!(conversation.teamId
                && await db.aiTeamMember.findFirst({ where: { teamId: conversation.teamId,
                    agentId: selectedAgentId, agent: { accountId: request.userId,
                        enabled: true, archivedAt: null } }, select: { agentId: true } }));
            if (!authorized) {
                await failInbound(claimResult.claim);
                return reply.code(403).send({ error: 'Coordinator assignee is not authorized' });
            }
        }
        if (intent === 'clarify') {
            try {
                const candidateIds = 'candidateAgentIds' in decision && Array.isArray(decision.candidateAgentIds)
                    ? decision.candidateAgentIds.filter((id): id is string => typeof id === 'string') : [];
                const allowedAgents = candidateIds.length ? await db.aiAgent.findMany({ where: {
                    id: { in: candidateIds }, accountId: request.userId,
                    enabled: true, archivedAt: null,
                    ...(conversation.teamId ? { teamMemberships: {
                        some: { teamId: conversation.teamId } } } : { id: conversation.agentId }),
                }, select: { id: true, name: true } }) : [];
                return reply.send(await persistClarification(request.userId, conversation.id, text,
                    decision.question ?? '请补充目标仓库、期望改动和验收条件。', claimResult.claim,
                    allowedAgents, undefined, 'options' in decision && Array.isArray(decision.options)
                        ? decision.options.filter((option): option is string => typeof option === 'string') : []));
            } catch (error) {
                await failInbound(claimResult.claim);
                return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to save clarification' });
            }
        }
        if (intent === 'chat') {
            try {
                return reply.send(await submitCoordinatorChat(request.userId, conversation, text, claimResult.claim));
            } catch (error) {
                await failInbound(claimResult.claim);
                return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to start coordinator chat' });
            }
        }
        let githubSource: Awaited<ReturnType<typeof resolveGithubChatSource>> = null;
        try {
            githubSource = await resolveGithubChatSource(request.userId, text, claimResult.claim);
        } catch (error) {
            await failInbound(claimResult.claim);
            const message = error instanceof Error ? error.message : 'Unable to create GitHub issue';
            return reply.code(message.includes('uncertain') ? 503 : 400).send({ error: message });
        }
        try {
        const taskTitle = intent === 'create_task' && 'title' in decision
            ? decision.title : text.split('\n')[0].slice(0, 120);
        const taskRequirements = intent === 'create_task' && 'requirements' in decision
            ? decision.requirements : text;
        const result = await submitWork(request.userId, {
            agentId: selectedAgentId, teamId: conversation.teamId ?? undefined, conversationId: conversation.id,
            clientMessageId: request.body.clientMessageId,
            title: taskTitle,
            summary: githubSource ? `${taskRequirements}\n\n${githubSource.deliveryInstruction}` : taskRequirements,
            sourceType: githubSource?.sourceType ?? 'execution',
            sourceLabel: githubSource?.sourceLabel ?? 'Conversation',
            sourceResourceId: githubSource?.sourceResourceId ?? conversation.id,
        }, claimResult.claim, clarificationId);
        return reply.code(201).send(result);
        } catch (error) {
            await failInbound(claimResult.claim);
            return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to create work item' });
        }
    });

    app.post('/v1/ai-team/work-items/:id/acceptance', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: acceptanceSchema },
    }, async (request, reply) => {
        const access = await db.$transaction(tx => authorizeWorkItemTx(tx, {
            actorAccountId: request.userId, workItemId: request.params.id,
            operation: 'approve',
        }));
        if (!access) return reply.code(404).send({ error: 'Work item not found' });
        if (request.body.status === 'changes_requested' && request.userId !== access.work.accountId) {
            const canRun = await db.$transaction(tx => authorizeWorkItemTx(tx, {
                actorAccountId: request.userId, workItemId: request.params.id,
                operation: 'run',
            }));
            if (!canRun) return reply.code(404).send({ error: 'Work item not found' });
        }
        const ownerAccountId = access.work.accountId;
        const work = await db.aiWorkItem.findFirst({
            where: { id: request.params.id, accountId: ownerAccountId },
            include: { orchestratorRun: { include: { tasks: {
                include: { executions: { orderBy: { attempt: 'desc' }, take: 1 } },
            } } } },
        });
        if (!work) return reply.code(404).send({ error: 'Work item not found' });
        const task = work.orchestratorRun.tasks.find((item) => item.id === work.orchestratorTaskId);
        if (request.body.status === 'approved') {
            const reviewedExecutionId = task?.executions[0]?.id;
            const result = await db.$transaction(async (tx) => {
                if (!await authorizeWorkItemTx(tx, { actorAccountId: request.userId,
                    workItemId: work.id, operation: 'approve' })) return 'missing';
                await tx.$queryRaw`SELECT id FROM "AiWorkItem" WHERE id=${work.id} FOR UPDATE`;
                const current = await tx.aiWorkItem.findFirst({ where: {
                    id: work.id, accountId: ownerAccountId },
                });
                if (!current) return 'missing';
                await tx.$queryRaw`SELECT id FROM "OrchestratorTask"
                    WHERE id=${current.orchestratorTaskId} FOR UPDATE`;
                await tx.$queryRaw`SELECT id FROM "OrchestratorRun"
                    WHERE id=${current.orchestratorRunId} FOR UPDATE`;
                const [currentTask, currentRun, latest] = await Promise.all([
                    tx.orchestratorTask.findUnique({ where: { id: current.orchestratorTaskId } }),
                    tx.orchestratorRun.findUnique({ where: { id: current.orchestratorRunId } }),
                    tx.orchestratorExecution.findFirst({ where: {
                        taskId: current.orchestratorTaskId }, orderBy: { attempt: 'desc' } }),
                ]);
                if (!currentTask || !currentRun || !latest || latest.id !== reviewedExecutionId
                    || request.body.reviewedExecutionId && latest.id !== request.body.reviewedExecutionId
                    || !request.body.reviewedExecutionId && latest.attempt > 1
                    || currentTask.status !== 'completed' || currentRun.status !== 'completed'
                    || latest.status !== 'completed') return 'stale';
                const version = current.projectId && current.projectVersion
                    ? await tx.aiProjectVersion.findUnique({ where: { projectId_version: {
                        projectId: current.projectId, version: current.projectVersion,
                    } } }) : null;
                const local = version?.kind === 'local';
                if (local) {
                    if (current.pullRequestUrl || current.pullRequestNumber
                        || current.sourceType === 'github') return 'delivery';
                    try {
                        const snapshot = await loadDispatchProjectSnapshot(tx, {
                            runId: currentRun.id, accountId: ownerAccountId,
                            metadata: currentRun.metadata, taskMachineId: currentTask.targetMachineId,
                            taskDirectory: currentTask.workingDirectory,
                            taskBaseCommit: currentTask.baseCommit,
                            dispatchMachineId: latest.machineId,
                        });
                        if (snapshot?.kind !== 'local') return 'delivery';
                    } catch { return 'delivery'; }
                } else if (current.deliveryVerificationStatus !== 'verified'
                    || !current.deliveryVerifiedAt) return 'delivery';
                await tx.aiWorkItem.update({ where: { id: current.id }, data: {
                    acceptanceStatus: 'approved', requiresDecision: false,
                    ...(local ? { deliveryVerificationStatus: 'local_accepted' } : {}),
                } });
                await tx.aiWorkItemAudit.create({ data: { workItemId: current.id,
                    actorAccountId: request.userId, action: 'approved',
                    before: { acceptanceStatus: current.acceptanceStatus },
                    after: { acceptanceStatus: 'approved', executionId: latest.id },
                } });
                if (!request.body.note) return;
                const payload: AiChatMessage = { id: `acceptance-${work.id}-${Date.now()}`, kind: 'text', sender: 'user', text: request.body.note, timeLabel: new Date().toISOString() };
                await tx.aiMessage.create({ data: { conversationId: current.conversationId,
                    sender: 'user', payload: { ...payload, actorAccountId: request.userId } as Prisma.InputJsonValue } });
                return 'approved';
            });
            if (result === 'missing') return reply.code(404).send({ error: 'Work item not found' });
            if (result === 'stale') return reply.code(409).send({ error: 'Only the latest completed work can be accepted' });
            if (result === 'delivery') return reply.code(409).send({ error: 'Delivery has not been verified' });
            return reply.send({ ok: true });
        }
        if (!request.body.clientMessageId) return reply.code(400).send({ error: 'clientMessageId is required' });
        const note = request.body.note || 'Revise the delivery based on the execution result and address the remaining issues.';
        const clientMessageId = request.userId === ownerAccountId
            ? request.body.clientMessageId
            : `actor:${request.userId}:${request.body.clientMessageId}`;
        const claimResult = await claimInbound({ accountId: ownerAccountId,
            conversationId: work.conversationId, clientMessageId },
        { kind: 'changes_requested', actorAccountId: request.userId, workItemId: work.id, note });
        if (claimResult.kind === 'completed') return reply.send({ ok: true, revision: claimResult.response });
        if (claimResult.kind === 'conflict') return reply.code(409).send({ error: 'Client message id conflict' });
        if (claimResult.kind === 'processing') return reply.code(503).send({ error: 'Request is processing' });
        if (!task || task.status !== 'completed') {
            await failInbound(claimResult.claim);
            return reply.code(409).send({ error: 'Only completed work can be revised' });
        }
        try {
            const revision = await resumeAiWork(ownerAccountId, work.conversationId,
                work.id, note, claimResult.claim, undefined, true, request.userId);
            return reply.send({ ok: true, revision });
        } catch (error) {
            await failInbound(claimResult.claim);
            return reply.code(409).send({ error: error instanceof Error ? error.message : 'Unable to resume revision' });
        }
    });

    app.post('/v1/ai-team/work-items/:id/verify-delivery', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) },
    }, async (request, reply) => {
        const work = await db.aiWorkItem.findFirst({ where: { id: request.params.id, accountId: request.userId },
            select: { id: true, orchestratorTaskId: true, deliveryVerificationStatus: true } });
        if (!work) return reply.code(404).send({ error: 'Work item not found' });
        const task = await db.orchestratorTask.findUnique({ where: { id: work.orchestratorTaskId }, select: { status: true } });
        if (task?.status !== 'completed') return reply.code(409).send({ error: 'Only completed work can be verified' });
        if (work.deliveryVerificationStatus === 'verified') return reply.send({ status: 'verified' });
        await db.aiWorkItem.updateMany({ where: { id: work.id, accountId: request.userId,
            deliveryVerificationStatus: { in: ['pending', 'blocked'] } },
            data: { deliveryVerificationStatus: 'pending', deliveryVerificationAttempts: 0,
                deliveryVerificationNextAt: new Date(), deliveryVerificationErrorCode: null } });
        return reply.code(202).send({ status: 'pending' });
    });

    app.post('/v1/ai-team/github-issue-intents/:conversationId/:clientMessageId/reconcile', {
        preHandler: app.authenticate,
        schema: { params: z.object({ conversationId: z.string(), clientMessageId: z.string() }),
            body: z.object({ issueNumber: z.number().int().positive().optional() }) },
    }, async (request, reply) => {
        const key = { accountId: request.userId, ...request.params };
        const intent = await db.aiGithubIssueIntent.findUnique({ where: { accountId_conversationId_clientMessageId: key } });
        if (!intent) return reply.code(404).send({ error: 'Issue intent not found' });
        if (intent.issueNumber) return reply.send({ status: 'succeeded', issueNumber: intent.issueNumber });
        if (!['creating', 'uncertain'].includes(intent.status)) {
            return reply.code(409).send({ error: 'Issue creation has not started' });
        }
        if (request.body.issueNumber) {
            try {
                if (!await verifyGithubIssueNumber(intent, request.body.issueNumber)) {
                    return reply.code(409).send({ error: 'Issue identity does not match this intent' });
                }
            } catch { return reply.code(503).send({ error: 'GitHub issue verification is unavailable' }); }
            await db.aiGithubIssueIntent.updateMany({ where: { ...key, issueNumber: null,
                status: { in: ['creating', 'uncertain'] } }, data: {
                issueNumber: request.body.issueNumber, status: 'succeeded', lastCheckedAt: new Date(),
                lastErrorCode: null, reconcileOwner: null, reconcileLeaseUntil: null,
            } });
        } else {
            await reconcileGithubIssueIntent(intent);
        }
        const refreshed = await db.aiGithubIssueIntent.findUniqueOrThrow({ where: {
            accountId_conversationId_clientMessageId: key,
        } });
        return reply.send({ status: refreshed.status, issueNumber: refreshed.issueNumber });
    });
}
