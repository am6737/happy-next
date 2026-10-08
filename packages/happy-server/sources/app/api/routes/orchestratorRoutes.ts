import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { delay } from "@/utils/delay";
import { warn } from "@/utils/log";
import {
    eventRouter,
    buildOrchestratorActivityEphemeral,
    buildOrchestratorRunTerminalEphemeral,
} from "@/app/events/eventRouter";
import { hasSessionPresence } from '@/app/events/eventBridge';
import { listConnectedUserRpcMethods, invokeUserRpc, hasUserRpcMethod } from "@/app/api/socket/rpcRegistry";
import { isApprovalTerminalFailure } from '@/app/ai/approvalTerminalFailure';
import { inTx } from "@/storage/inTx";
import { feedPost } from "@/app/feed/feedPost";
import { Context } from "@/context";
import { randomUUID } from "node:crypto";
import { integrationExpectedHash } from '@/app/ai/integrationHash';
import { loadDispatchProjectSnapshot } from '@/app/ai/projectSnapshot';
import { readAiRuntimeContract } from '@/app/ai/runtimeContract';
import { assertExecutionCapabilityTx } from '@/app/ai/workspaceAuth';
import { AiBudgetExceeded, reserveAiRunBudgetTx } from '@/app/ai/budget';
import { getUserOctokit } from '@/app/github/githubApi';
import {
    MODEL_MODE_DEFAULT,
    getValidModelModesForAgent,
    isModelMode,
    isModelModeForAgent,
    AiIntegrationProofSchema,
} from "happy-wire";
import {
    addTaskCount,
    buildPendCursor,
    createEmptySummaryInternal,
    decodeListCursor,
    deriveRunStatus,
    encodeListCursor,
    isExecutionTerminal,
    isRunTerminal,
    type RunSummary,
    toPublicSummary,
} from "@/app/orchestrator/state";

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;
const RUN_STATUSES = ['queued', 'running', 'canceling', 'completed', 'failed', 'cancelled'] as const;
const EXECUTION_FINAL_STATUSES = ['completed', 'failed', 'cancelled', 'timeout'] as const;
const LIST_RUN_STATUS_FILTERS = ['active', 'terminal', ...RUN_STATUSES] as const;
const IDEMPOTENCY_RETRY_TIMES = 2;
const CLI_DETECTION_COMMAND =
    '(command -v claude >/dev/null 2>&1 && echo "claude:true" || echo "claude:false") && ' +
    '(command -v codex >/dev/null 2>&1 && echo "codex:true" || echo "codex:false") && ' +
    '(command -v gemini >/dev/null 2>&1 && echo "gemini:true" || echo "gemini:false") && ' +
    'echo "hostname:$(hostname 2>/dev/null || echo \'\')"';
const CLI_DETECTION_TIMEOUT_MS = 20_000;
function modelLooksIncompatibleWithProvider(provider: string, model: string): boolean {
    const value = model.toLowerCase();
    if (provider === 'claude') return value.startsWith('gpt-') || value.startsWith('gemini-') || value.includes('codex');
    if (provider === 'codex') return value.startsWith('claude-') || value.startsWith('gemini-');
    if (provider === 'gemini') return value.startsWith('claude-') || value.startsWith('gpt-') || value.includes('codex');
    return false;
}
const IDEMPOTENCY_RETRY_DELAY_MS = 10;
const DEFAULT_CONTEXT_MAX_CONCURRENCY = 2;
const DEFAULT_CONTEXT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_CONTEXT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_CONTEXT_RETRY_MAX_ATTEMPTS = 1;
const DEFAULT_CONTEXT_RETRY_BACKOFF_MS = 0;
const PEND_POLL_INTERVAL_MS = 3000;

function extractGithubDeliveryMetadata(text: string | null | undefined): {
    issue?: { resourceId: string; label: string };
    pullRequest?: { url: string; number: number };
} {
    const value = text ?? '';
    const issueMatch = value.match(/Created GitHub issue:\s*https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i);
    const prMatch = value.match(/Created pull request:\s*https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
    return {
        issue: issueMatch ? {
            resourceId: `${issueMatch[1]}/${issueMatch[2]}#${issueMatch[3]}`,
            label: `GitHub ${issueMatch[1]}/${issueMatch[2]}#${issueMatch[3]}`,
        } : undefined,
        pullRequest: prMatch ? {
            url: `https://github.com/${prMatch[1]}/${prMatch[2]}/pull/${prMatch[3]}`,
            number: Number(prMatch[3]),
        } : undefined,
    };
}

export async function verifyGithubDeliveryMetadata(userId: string, text: string | null | undefined,
    branchName: string | null | undefined, commitSha: string | null | undefined,
    expectedRepositoryId: bigint, expectedIssue?: string) {
    const candidate = extractGithubDeliveryMetadata(text);
    if (!candidate.issue || !candidate.pullRequest || !branchName || !commitSha
        || !/^[0-9a-f]{40}$/i.test(commitSha)
        || (expectedIssue && expectedIssue !== candidate.issue.resourceId)) return null;
    const issueMatch = candidate.issue.resourceId.match(/^([^/#]+)\/([^/#]+)#([1-9]\d*)$/);
    const prMatch = candidate.pullRequest.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/);
    if (!issueMatch || !prMatch || issueMatch[1].toLowerCase() !== prMatch[1].toLowerCase()
        || issueMatch[2].toLowerCase() !== prMatch[2].toLowerCase()) return null;
    const [, owner, repo, issueNumber] = issueMatch;
    const octokit = await getUserOctokit(userId);
    const signal = AbortSignal.timeout(20_000);
    const [{ data: repository }, { data: issue }, { data: pr }] = await Promise.all([
        octokit.rest.repos.get({ owner, repo, request: { signal } }),
        octokit.rest.issues.get({ owner, repo, issue_number: Number(issueNumber), request: { signal } }),
        octokit.rest.pulls.get({ owner, repo, pull_number: candidate.pullRequest.number, request: { signal } }),
    ]);
    if (BigInt(repository.id) !== expectedRepositoryId || !repository.permissions?.push
        || issue.pull_request || issue.number !== Number(issueNumber)
        || pr.number !== candidate.pullRequest.number || pr.html_url !== candidate.pullRequest.url
        || pr.head.ref !== branchName || (pr.state === 'closed' && !pr.merged)
        || pr.head.repo?.id !== repository.id || pr.base.repo?.id !== repository.id
        || pr.base.ref !== repository.default_branch
        || !new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b`, 'i').test(pr.body ?? '')) return null;
    if (pr.head.sha !== commitSha) {
        const { data: comparison } = await octokit.rest.repos.compareCommits({ owner, repo,
            base: commitSha, head: pr.head.sha, request: { signal } });
        if (comparison.status !== 'ahead' && comparison.status !== 'identical') return null;
    }
    const [{ data: checks }, { data: statuses }] = await Promise.all([
        octokit.rest.checks.listForRef({ owner, repo, ref: pr.head.sha, per_page: 100, request: { signal } }),
        octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: pr.head.sha, request: { signal } }),
    ]);
    if ((checks.total_count === 0 && statuses.total_count === 0)
        || checks.total_count > checks.check_runs.length
        || checks.check_runs.some((check: { status: string; conclusion: string | null }) => check.status !== 'completed' || check.conclusion !== 'success')
        || (statuses.total_count > 0 && statuses.state !== 'success')) return null;
    return { issue: candidate.issue, pullRequest: candidate.pullRequest,
        repositoryId: BigInt(repository.id), repositoryName: repository.full_name,
        state: pr.merged ? 'merged' : pr.state, mergedAt: pr.merged_at ? new Date(pr.merged_at) : null };
}

type ProviderName = typeof PROVIDERS[number];

type BashRpcResponse = {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode?: number;
};

const MACHINE_IDENTITY_TIMEOUT_MS = 5_000;

async function fetchMachineNames(
    userId: string,
    machineIds: string[],
): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (machineIds.length === 0) {
        return result;
    }

    const promises = machineIds.map(async (machineId): Promise<[string, string | null]> => {
        if (!hasUserRpcMethod(userId, `${machineId}:machine-identity`)) {
            return [machineId, null];
        }
        try {
            const response = await invokeUserRpc(
                userId,
                `${machineId}:machine-identity`,
                {},
                MACHINE_IDENTITY_TIMEOUT_MS,
            ) as { name?: unknown } | null;
            const name = typeof response?.name === 'string' ? response.name : null;
            return [machineId, name];
        } catch {
            return [machineId, null];
        }
    });

    const settled = await Promise.allSettled(promises);
    for (const entry of settled) {
        if (entry.status === 'fulfilled' && entry.value[1]) {
            result.set(entry.value[0], entry.value[1]);
        }
    }
    return result;
}

type DetectionResult = {
    providers: ProviderName[];
    hostname?: string;
};

/**
 * Detect which CLI providers are installed on the given machines via bash RPC,
 * plus the machine's OS hostname. Runs detection commands in parallel with a timeout.
 * On failure/timeout, returns empty providers for that machine.
 */
async function detectMachineProviders(
    userId: string,
    machineIds: string[],
): Promise<Map<string, DetectionResult>> {
    const result = new Map<string, DetectionResult>();
    if (machineIds.length === 0) {
        return result;
    }

    const detectionPromises = machineIds.map(async (machineId): Promise<[string, DetectionResult]> => {
        if (!hasUserRpcMethod(userId, `${machineId}:bash`)) {
            return [machineId, { providers: [] }];
        }

        try {
            const response = await invokeUserRpc(
                userId,
                `${machineId}:bash`,
                { command: CLI_DETECTION_COMMAND, cwd: '/' },
                CLI_DETECTION_TIMEOUT_MS,
            ) as BashRpcResponse;

            if (!response || !response.success) {
                return [machineId, { providers: [] }];
            }

            const statusByProvider = new Map<ProviderName, boolean>();
            let hostname: string | undefined;
            const lines = (response.stdout || '').trim().split('\n');
            for (const line of lines) {
                const sepIdx = line.indexOf(':');
                if (sepIdx < 0) continue;
                const keyRaw = line.slice(0, sepIdx).trim();
                const valueRaw = line.slice(sepIdx + 1).trim();
                if (!keyRaw) continue;
                if (keyRaw === 'hostname') {
                    if (valueRaw) hostname = valueRaw;
                    continue;
                }
                if (!PROVIDERS.includes(keyRaw as ProviderName)) continue;
                if (!valueRaw) continue;
                statusByProvider.set(keyRaw as ProviderName, valueRaw === 'true');
            }

            const providers = PROVIDERS.filter((provider) => statusByProvider.get(provider) === true);
            return [machineId, { providers, hostname }];
        } catch {
            return [machineId, { providers: [] }];
        }
    });

    const settled = await Promise.allSettled(detectionPromises);
    for (const entry of settled) {
        if (entry.status === 'fulfilled') {
            result.set(entry.value[0], entry.value[1]);
        }
    }

    return result;
}

async function queryOrchestratorSessionActivity(
    userId: string,
    controllerSessionId: string,
): Promise<Record<string, string[]>> {
    const rows = await db.orchestratorTask.findMany({
        where: {
            run: { accountId: userId, controllerSessionId, status: { in: ['queued', 'running', 'canceling'] } },
            status: { in: ['queued', 'dispatching', 'running'] },
        },
        select: {
            id: true,
            runId: true,
        },
    });

    const activity: Record<string, string[]> = {};
    for (const row of rows) {
        if (!activity[row.runId]) {
            activity[row.runId] = [];
        }
        activity[row.runId].push(row.id);
    }
    return activity;
}

/**
 * Emit an ephemeral orchestrator-activity event with current active run/task index
 * for the given controllerSessionId. Called after status-changing transactions commit.
 */
async function emitOrchestratorActivity(userId: string, controllerSessionId: string | null) {
    if (!controllerSessionId) return;
    const [activity, totalRunCount] = await Promise.all([
        queryOrchestratorSessionActivity(userId, controllerSessionId),
        db.orchestratorRun.count({
            where: { accountId: userId, controllerSessionId },
        }),
    ]);
    eventRouter.emitEphemeral({
        userId,
        payload: buildOrchestratorActivityEphemeral(controllerSessionId, activity, totalRunCount),
    });
}

const submitTaskSchema = z.object({
    taskKey: z.string().min(1).max(128).optional(),
    title: z.string().min(1).max(256).optional(),
    provider: z.enum(PROVIDERS),
    model: z.string().min(1).max(128).optional(),
    prompt: z.string().min(1).max(65536),
    workingDirectory: z.string().max(512).optional(),
    permissionMode: z.enum(['read_only', 'approval', 'guarded_auto']).optional(),
    timeoutMs: z.coerce.number().int().min(1000).max(24 * 60 * 60 * 1000).optional(),
    dependsOn: z.array(z.string().min(1).max(128)).max(31).optional(),
    retry: z.object({
        maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
        backoffMs: z.coerce.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    }).optional(),
    target: z.object({
        type: z.enum(['current_machine', 'machine_id']),
        machineId: z.string().optional(),
    }).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
}).refine((value) => {
    if (value.target?.type === 'machine_id') {
        return !!value.target.machineId;
    }
    return true;
}, {
    message: 'target.machineId is required when target.type is machine_id',
    path: ['target', 'machineId'],
});

const submitBodySchema = z.object({
    title: z.string().min(1).max(256),
    controllerSessionId: z.string().optional(),
    controllerMachineId: z.string().optional(),
    tasks: z.array(submitTaskSchema).min(1).max(32),
    maxConcurrency: z.coerce.number().int().min(1).max(8).optional(),
    mode: z.enum(['blocking', 'async']).optional(),
    waitTimeoutMs: z.coerce.number().int().min(1000).max(60 * 60 * 1000).optional(),
    pollIntervalMs: z.coerce.number().int().min(200).max(60_000).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    metadata: z.record(z.string(), z.unknown()).optional().refine((metadata) =>
        !metadata || !Object.keys(metadata).some((key) =>
            /^(?:coordinatorChat|conversationId|aiAgentId|aiTeamId|aiWorkItem|githubRepositoryId)$/.test(key)
            || /^(?:ai|coordinator|github)/i.test(key)),
    { message: 'Internal metadata keys are reserved' }),
});

type RunWithTasks = {
    id: string;
    metadata?: Prisma.JsonValue | null;
    aiWorkItem?: { orchestratorTaskId: string; deliveryVerificationStatus: string } | null;
    title: string;
    status: string;
    maxConcurrency: number;
    controllerSessionId: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    cancelRequestedAt: Date | null;
    tasks: Array<{
        id: string;
        seq: number;
        taskKey: string | null;
        title: string | null;
        provider: string;
        model: string | null;
        workingDirectory: string | null;
        dependsOnTaskKeys: string[];
        retryMaxAttempts: number;
        retryBackoffMs: number;
        prompt?: string | null;
        nextAttemptAt: Date | null;
        status: string;
        outputSummary: string | null;
        outputText: string | null;
        finalResponse: string | null;
        errorCode: string | null;
        errorMessage: string | null;
        createdAt: Date;
        updatedAt: Date;
        executions?: Array<{
            id: string;
            attempt: number;
            status: string;
            machineId: string;
            provider: string;
            model: string | null;
            childSessionId: string | null;
            executionType: string;
            resumeMessage: string | null;
            startedAt: Date | null;
            finishedAt: Date | null;
            exitCode: number | null;
            signal: string | null;
            errorCode: string | null;
            errorMessage: string | null;
            outputSummary: string | null;
            outputText: string | null;
            finalResponse: string | null;
            capabilityProtocolVersion: number;
            createdAt: Date;
            updatedAt: Date;
        }>;
    }>;
};

type TaskWithRun = RunWithTasks['tasks'][number] & {
    run: {
        id: string;
        title: string;
        status: string;
        updatedAt: Date;
        metadata?: Prisma.JsonValue | null;
        aiWorkItem?: { orchestratorTaskId: string; deliveryVerificationStatus: string } | null;
    };
};

function sendError(reply: any, statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    return reply.code(statusCode).send({
        ok: false,
        error: {
            code,
            message,
            ...(details ? { details } : {}),
        },
    });
}

function isUniqueConstraintError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    if (!('code' in error)) {
        return false;
    }
    return (error as { code?: unknown }).code === 'P2002';
}

function mapTask(task: RunWithTasks['tasks'][number],
    metadata?: Prisma.JsonValue | null,
    deliveryWork?: RunWithTasks['aiWorkItem'], includeExecutions = false) {
    const contract = readAiRuntimeContract(metadata);
    const latest = task.executions?.slice().sort((a, b) => b.attempt - a.attempt)[0];
    const trustedAnswer = task.status === 'completed' && latest?.status === 'completed'
        && latest.capabilityProtocolVersion === 1 && contract !== 'invalid'
        && !!latest.finalResponse?.trim() && task.finalResponse === latest.finalResponse;
    const deliveryVerified = contract && contract !== 'invalid' && contract.deliveryProofVersion === 1
        && deliveryWork?.orchestratorTaskId === task.id
        ? task.status === 'completed' && latest?.status === 'completed'
            && deliveryWork.deliveryVerificationStatus === 'verified' : null;
    return {
        taskId: task.id,
        seq: task.seq,
        taskKey: task.taskKey,
        title: task.title,
        status: task.status,
        provider: task.provider,
        model: task.model,
        prompt: task.prompt,
        workingDirectory: task.workingDirectory,
        dependsOn: task.dependsOnTaskKeys,
        retry: {
            maxAttempts: task.retryMaxAttempts,
            backoffMs: task.retryBackoffMs,
        },
        nextAttemptAt: task.nextAttemptAt?.toISOString() ?? null,
        outputSummary: null,
        outputText: null,
        finalResponse: trustedAnswer ? task.finalResponse : null,
        answerVerified: trustedAnswer,
        deliveryVerified,
        errorCode: task.errorCode,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        ...(includeExecutions && Array.isArray(task.executions) ? {
            executions: task.executions.map((execution) => ({
                executionId: execution.id,
                attempt: execution.attempt,
                status: execution.status,
                machineId: execution.machineId,
                provider: execution.provider,
                model: execution.model,
                childSessionId: execution.childSessionId,
                executionType: execution.executionType,
                resumeMessage: execution.resumeMessage,
                startedAt: execution.startedAt?.toISOString() ?? null,
                finishedAt: execution.finishedAt?.toISOString() ?? null,
                exitCode: execution.exitCode,
                signal: execution.signal,
                errorCode: execution.errorCode,
                errorMessage: execution.errorMessage,
                outputSummary: null,
                outputText: null,
                finalResponse: execution.status === 'completed'
                    && execution.capabilityProtocolVersion === 1 && contract !== 'invalid'
                    && !!execution.finalResponse?.trim() ? execution.finalResponse : null,
                answerVerified: execution.status === 'completed'
                    && execution.capabilityProtocolVersion === 1 && contract !== 'invalid'
                    && !!execution.finalResponse?.trim(),
                deliveryVerified: execution.id === latest?.id ? deliveryVerified : null,
                createdAt: execution.createdAt.toISOString(),
                updatedAt: execution.updatedAt.toISOString(),
            })),
        } : {}),
    };
}

function mapRunMachinesFromTasks(run: RunWithTasks): string[] {
    const machineSet = new Set<string>();
    for (const task of run.tasks) {
        if (!Array.isArray(task.executions)) {
            continue;
        }
        for (const execution of task.executions) {
            machineSet.add(execution.machineId);
        }
    }
    return [...machineSet];
}

function mapRunResponse(run: RunWithTasks, summary: RunSummary, includeTasks: boolean,
    machines: string[] = [], includeExecutions = false) {
    return {
        runId: run.id,
        title: run.title,
        status: run.status,
        maxConcurrency: run.maxConcurrency,
        controllerSessionId: run.controllerSessionId,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
        summary,
        machines,
        ...(includeTasks ? { tasks: run.tasks.map(task => mapTask(task,
            run.metadata, run.aiWorkItem, includeExecutions)) } : {}),
    };
}

function summarizeTasksByStatus(tasks: Array<{ status: string }>): RunSummary {
    const internal = createEmptySummaryInternal();
    for (const task of tasks) {
        addTaskCount(internal, task.status, 1);
    }
    return toPublicSummary(internal);
}

function summaryFromGrouped(grouped: Array<{ status: string; _count: { _all: number } }>): RunSummary {
    const internal = createEmptySummaryInternal();
    for (const row of grouped) {
        addTaskCount(internal, row.status, row._count._all);
    }
    return toPublicSummary(internal);
}

function summaryMapFromGrouped(grouped: Array<{ runId: string; status: string; _count: { _all: number } }>): Map<string, RunSummary> {
    const internalByRun = new Map<string, ReturnType<typeof createEmptySummaryInternal>>();
    for (const row of grouped) {
        let summary = internalByRun.get(row.runId);
        if (!summary) {
            summary = createEmptySummaryInternal();
            internalByRun.set(row.runId, summary);
        }
        addTaskCount(summary, row.status, row._count._all);
    }

    const out = new Map<string, RunSummary>();
    for (const [runId, internal] of internalByRun.entries()) {
        out.set(runId, toPublicSummary(internal));
    }
    return out;
}

async function loadRunForUser(userId: string, runId: string, includeTasks: boolean, includeExecutions: boolean = false): Promise<{ run: RunWithTasks; summary: RunSummary } | null> {
    const run = await db.orchestratorRun.findFirst({
        where: { id: runId, accountId: userId },
        select: {
            id: true,
            title: true,
            status: true,
            maxConcurrency: true,
            controllerSessionId: true,
            metadata: true,
            aiWorkItem: { select: { orchestratorTaskId: true, deliveryVerificationStatus: true } },
            createdAt: true,
            updatedAt: true,
            completedAt: true,
            cancelRequestedAt: true,
            tasks: includeTasks ? {
                orderBy: { seq: 'asc' },
                select: {
                    id: true,
                    seq: true,
                    taskKey: true,
                    title: true,
                    provider: true,
                    model: true,
                    workingDirectory: true,
                    dependsOnTaskKeys: true,
                    retryMaxAttempts: true,
                    retryBackoffMs: true,
                    nextAttemptAt: true,
                    status: true,
                    outputSummary: true,
                    outputText: true,
                    finalResponse: true,
                    errorCode: true,
                    errorMessage: true,
                    createdAt: true,
                    updatedAt: true,
                    executions: {
                        orderBy: { attempt: includeExecutions ? 'asc' : 'desc' },
                        ...(includeExecutions ? {} : { take: 1 }),
                        select: {
                            id: true,
                            attempt: true,
                            status: true,
                            machineId: true,
                            provider: true,
                            model: true,
                            childSessionId: true,
                            executionType: true,
                            resumeMessage: true,
                            startedAt: true,
                            finishedAt: true,
                            exitCode: true,
                            signal: true,
                            errorCode: true,
                            errorMessage: true,
                            outputSummary: true,
                            outputText: true,
                            finalResponse: true,
                            capabilityProtocolVersion: true,
                            createdAt: true,
                            updatedAt: true,
                        },
                    },
                },
            } : false,
        },
    });

    if (!run) {
        return null;
    }

    if (includeTasks) {
        return { run: run as RunWithTasks, summary: summarizeTasksByStatus(run.tasks) };
    }

    const grouped = await db.orchestratorTask.groupBy({
        by: ['status'],
        where: { runId: run.id },
        _count: { _all: true },
    });
    return {
        run: { ...run, tasks: [] } as RunWithTasks,
        summary: summaryFromGrouped(grouped),
    };
}

async function loadTaskForUser(
    userId: string,
    runId: string,
    taskId: string,
    includeExecutions: boolean = false,
): Promise<TaskWithRun | null> {
    const task = await db.orchestratorTask.findFirst({
        where: {
            id: taskId,
            runId,
            run: {
                accountId: userId,
            },
        },
        select: {
            id: true,
            seq: true,
            taskKey: true,
            title: true,
            prompt: true,
            provider: true,
            model: true,
            workingDirectory: true,
            dependsOnTaskKeys: true,
            retryMaxAttempts: true,
            retryBackoffMs: true,
            nextAttemptAt: true,
            status: true,
            outputSummary: true,
            outputText: true,
            finalResponse: true,
            errorCode: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            run: {
                select: {
                    id: true,
                    title: true,
                    status: true,
                    updatedAt: true,
                    metadata: true,
                    aiWorkItem: { select: { orchestratorTaskId: true, deliveryVerificationStatus: true } },
                },
            },
            executions: {
                orderBy: { attempt: includeExecutions ? 'asc' : 'desc' },
                ...(includeExecutions ? {} : { take: 1 }),
                select: {
                    id: true,
                    attempt: true,
                    status: true,
                    machineId: true,
                    provider: true,
                    model: true,
                    childSessionId: true,
                    executionType: true,
                    resumeMessage: true,
                    startedAt: true,
                    finishedAt: true,
                    exitCode: true,
                    signal: true,
                    errorCode: true,
                    errorMessage: true,
                    outputSummary: true,
                    outputText: true,
                    finalResponse: true,
                    capabilityProtocolVersion: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        },
    });

    return (task as TaskWithRun | null) ?? null;
}

function resolveRunStatusFilter(status?: string): string[] | undefined {
    if (!status) {
        return undefined;
    }
    if (status === 'active') {
        return ['queued', 'running', 'canceling'];
    }
    if (status === 'terminal') {
        return ['completed', 'failed', 'cancelled'];
    }
    return [status];
}

function validateTaskKeyUniqueness(tasks: z.infer<typeof submitTaskSchema>[]): string | null {
    const seen = new Set<string>();
    for (const task of tasks) {
        if (!task.taskKey) {
            continue;
        }
        if (seen.has(task.taskKey)) {
            return task.taskKey;
        }
        seen.add(task.taskKey);
    }
    return null;
}

type TaskDependencyValidationIssue = {
    code: 'INVALID_DEPENDENCY' | 'INVALID_DAG_CYCLE';
    message: string;
};

function validateTaskDependencies(tasks: z.infer<typeof submitTaskSchema>[]): TaskDependencyValidationIssue | null {
    const keyToTaskIndex = new Map<string, number>();
    for (let index = 0; index < tasks.length; index++) {
        const taskKey = tasks[index].taskKey;
        if (!taskKey) {
            continue;
        }
        keyToTaskIndex.set(taskKey, index + 1);
    }

    for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        const seq = index + 1;
        const dependsOn = task.dependsOn ?? [];
        const localSeen = new Set<string>();

        for (const dep of dependsOn) {
            if (localSeen.has(dep)) {
                return {
                    code: 'INVALID_DEPENDENCY',
                    message: `Task seq ${seq} has duplicate dependency: ${dep}`,
                };
            }
            localSeen.add(dep);

            if (task.taskKey && dep === task.taskKey) {
                return {
                    code: 'INVALID_DEPENDENCY',
                    message: `Task seq ${seq} depends on itself: ${dep}`,
                };
            }

            if (!keyToTaskIndex.has(dep)) {
                return {
                    code: 'INVALID_DEPENDENCY',
                    message: `Task seq ${seq} depends on unknown taskKey: ${dep}`,
                };
            }
        }
    }

    const keyedTasks = tasks
        .map((task, index) => ({ task, seq: index + 1 }))
        .filter((entry) => !!entry.task.taskKey);
    if (keyedTasks.length === 0) {
        return null;
    }

    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const entry of keyedTasks) {
        const key = entry.task.taskKey!;
        inDegree.set(key, 0);
        outgoing.set(key, []);
    }

    for (const entry of keyedTasks) {
        const key = entry.task.taskKey!;
        for (const dep of entry.task.dependsOn ?? []) {
            outgoing.get(dep)!.push(key);
            inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
        }
    }

    const queue = Array.from(inDegree.entries())
        .filter(([, degree]) => degree === 0)
        .map(([key]) => key);
    let processed = 0;

    while (queue.length > 0) {
        const current = queue.shift()!;
        processed += 1;
        for (const next of outgoing.get(current) ?? []) {
            const nextDegree = (inDegree.get(next) ?? 0) - 1;
            inDegree.set(next, nextDegree);
            if (nextDegree === 0) {
                queue.push(next);
            }
        }
    }

    if (processed !== keyedTasks.length) {
        const cyclicTaskKeys = Array.from(inDegree.entries())
            .filter(([, degree]) => degree > 0)
            .map(([key]) => key)
            .slice(0, 5);
        return {
            code: 'INVALID_DAG_CYCLE',
            message: `Task dependency cycle detected${cyclicTaskKeys.length > 0 ? `: ${cyclicTaskKeys.join(', ')}` : ''}`,
        };
    }

    return null;
}

async function markDependencyFailedTasksInCancelTx(tx: Prisma.TransactionClient, runId: string): Promise<void> {
    const keyedTasks = await tx.orchestratorTask.findMany({
        where: {
            runId,
            taskKey: { not: null },
        },
        select: {
            taskKey: true,
            status: true,
        },
    });
    const taskKeyToStatus = new Map<string, string>();
    for (const task of keyedTasks) {
        if (task.taskKey) {
            taskKeyToStatus.set(task.taskKey, task.status);
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        const candidateTasks = await tx.orchestratorTask.findMany({
            where: {
                runId,
                status: { in: ['queued', 'cancelled'] },
            },
            orderBy: { seq: 'asc' },
            select: {
                id: true,
                taskKey: true,
                status: true,
                dependsOnTaskKeys: true,
            },
        });

        for (const task of candidateTasks) {
            const dependencies = task.dependsOnTaskKeys ?? [];
            if (dependencies.length === 0) {
                continue;
            }

            let dependencyFailedKey: string | null = null;
            for (const dependencyKey of dependencies) {
                const dependencyStatus = taskKeyToStatus.get(dependencyKey);
                if (
                    dependencyStatus === 'failed'
                    || dependencyStatus === 'cancelled'
                    || dependencyStatus === 'dependency_failed'
                ) {
                    dependencyFailedKey = dependencyKey;
                    break;
                }
            }

            if (!dependencyFailedKey) {
                continue;
            }

            const updated = await tx.orchestratorTask.updateMany({
                where: {
                    id: task.id,
                    status: { in: ['queued', 'cancelled'] },
                },
                data: {
                    status: 'dependency_failed',
                    errorCode: 'DEPENDENCY_FAILED',
                    errorMessage: `Dependency failed: ${dependencyFailedKey}`,
                    nextAttemptAt: null,
                },
            });
            if (updated.count > 0) {
                changed = true;
                if (task.taskKey) {
                    taskKeyToStatus.set(task.taskKey, 'dependency_failed');
                }
            }
        }
    }
}

export function orchestratorRoutes(app: Fastify) {
    app.get('/v1/orchestrator/context', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const machineConnections = eventRouter.getConnections(userId);
        const onlineMachineIds = new Set<string>();
        for (const connection of machineConnections ?? []) {
            if (connection.connectionType === 'machine-scoped' && connection.socket.connected) {
                onlineMachineIds.add(connection.machineId);
            }
        }
        const dispatchReadyMachineIds = new Set<string>();
        for (const method of listConnectedUserRpcMethods(userId)) {
            if (method.endsWith(':orchestrator-dispatch')) {
                dispatchReadyMachineIds.add(method.slice(0, -':orchestrator-dispatch'.length));
            }
        }

        const machines = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' },
            take: 50,
            select: {
                id: true,
                active: true,
                lastActiveAt: true,
            },
        });
        const dispatchReadyIds = [...dispatchReadyMachineIds];
        const onlineIds = [...onlineMachineIds];
        const [detectedProviders, identityNames] = await Promise.all([
            detectMachineProviders(userId, dispatchReadyIds),
            fetchMachineNames(userId, onlineIds),
        ]);

        const machineList = machines.map((machine) => {
            const online = onlineMachineIds.has(machine.id);
            const dispatchReady = dispatchReadyMachineIds.has(machine.id);
            const detection = detectedProviders.get(machine.id);
            const providers = detection?.providers ?? [];
            const modelModes: Record<string, readonly string[]> = {};
            for (const provider of providers) {
                modelModes[provider] = getValidModelModesForAgent(provider);
            }
            const name = identityNames.get(machine.id) ?? detection?.hostname;
            return {
                machineId: machine.id,
                ...(name ? { name } : {}),
                active: machine.active,
                online,
                dispatchReady,
                lastActiveAt: machine.lastActiveAt.toISOString(),
                providers,
                modelModes,
            };
        }).sort((a, b) => {
            if (a.dispatchReady !== b.dispatchReady) {
                return a.dispatchReady ? -1 : 1;
            }
            if (a.online !== b.online) {
                return a.online ? -1 : 1;
            }
            return b.lastActiveAt.localeCompare(a.lastActiveAt);
        });

        return reply.send({
            ok: true,
            data: {
                providers: PROVIDERS,
                modelModes: {
                    claude: getValidModelModesForAgent('claude'),
                    codex: getValidModelModesForAgent('codex'),
                    gemini: getValidModelModesForAgent('gemini'),
                },
                defaults: {
                    mode: 'async',
                    maxConcurrency: DEFAULT_CONTEXT_MAX_CONCURRENCY,
                    waitTimeoutMs: DEFAULT_CONTEXT_WAIT_TIMEOUT_MS,
                    pollIntervalMs: DEFAULT_CONTEXT_POLL_INTERVAL_MS,
                    retryMaxAttempts: DEFAULT_CONTEXT_RETRY_MAX_ATTEMPTS,
                    retryBackoffMs: DEFAULT_CONTEXT_RETRY_BACKOFF_MS,
                },
                machines: machineList,
            },
        });
    });

    app.post('/v1/orchestrator/submit', {
        preHandler: app.authenticate,
        schema: {
            body: submitBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const body = request.body;

        const duplicatedTaskKey = validateTaskKeyUniqueness(body.tasks);
        if (duplicatedTaskKey) {
            return sendError(reply, 400, 'INVALID_ARGUMENT', `Duplicate taskKey in request: ${duplicatedTaskKey}`);
        }
        const dependencyIssue = validateTaskDependencies(body.tasks);
        if (dependencyIssue) {
            return sendError(reply, 400, dependencyIssue.code, dependencyIssue.message);
        }
        const normalizedTaskModels: Array<string | undefined> = [];
        for (let index = 0; index < body.tasks.length; index++) {
            const task = body.tasks[index];
            const model = task.model;
            if (!model || model === MODEL_MODE_DEFAULT) {
                normalizedTaskModels.push(undefined);
                continue;
            }
            if (modelLooksIncompatibleWithProvider(task.provider, model) || (isModelMode(model) && !isModelModeForAgent(task.provider, model))) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', `Task seq ${index + 1} has invalid model "${model}" for provider "${task.provider}"`);
            }
            normalizedTaskModels.push(model);
        }

        const controllerMachineId: string | null = body.controllerMachineId ?? null;
        if (body.controllerSessionId) {
            const controllerSession = await db.session.findFirst({
                where: {
                    id: body.controllerSessionId,
                    accountId: userId,
                },
                select: { id: true },
            });
            if (!controllerSession) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'controllerSessionId does not belong to current account');
            }
        }

        const loadExistingByIdempotency = async (): Promise<{ run: RunWithTasks; summary: RunSummary } | null> => {
            if (!body.idempotencyKey) {
                return null;
            }
            const existing = await db.orchestratorRun.findFirst({
                where: {
                    accountId: userId,
                    idempotencyKey: body.idempotencyKey,
                },
                select: { id: true },
            });
            if (!existing) {
                return null;
            }
            return loadRunForUser(userId, existing.id, true);
        };
        const loadExistingByIdempotencyWithRetry = async (): Promise<{ run: RunWithTasks; summary: RunSummary } | null> => {
            for (let attempt = 0; attempt <= IDEMPOTENCY_RETRY_TIMES; attempt++) {
                const existing = await loadExistingByIdempotency();
                if (existing) {
                    return existing;
                }
                if (attempt < IDEMPOTENCY_RETRY_TIMES) {
                    await delay(IDEMPOTENCY_RETRY_DELAY_MS);
                }
            }
            return null;
        };

        const existing = await loadExistingByIdempotency();
        if (existing) {
            return reply.send({
                ok: true,
                data: {
                    runId: existing.run.id,
                    mode: body.mode ?? 'async',
                    terminal: isRunTerminal(existing.run.status),
                    run: {
                        status: existing.run.status,
                        createdAt: existing.run.createdAt.toISOString(),
                        updatedAt: existing.run.updatedAt.toISOString(),
                        summary: existing.summary,
                    },
                    tasks: existing.run.tasks.map(task => mapTask(task)),
                    next: isRunTerminal(existing.run.status) ? undefined : { hint: 'Await <orchestrator-callback>.', runId: existing.run.id },
                },
            });
        }

        try {
            const created = await db.$transaction(async (tx: Prisma.TransactionClient) => {
                const run = await tx.orchestratorRun.create({
                    data: {
                        accountId: userId,
                        controllerSessionId: body.controllerSessionId,
                        title: body.title,
                        status: 'queued',
                        maxConcurrency: body.maxConcurrency ?? 2,
                        idempotencyKey: body.idempotencyKey,
                        metadata: body.metadata as Prisma.InputJsonValue | undefined,
                    },
                    select: {
                        id: true,
                        title: true,
                        status: true,
                        maxConcurrency: true,
                        controllerSessionId: true,
                        createdAt: true,
                        updatedAt: true,
                        completedAt: true,
                        cancelRequestedAt: true,
                    },
                });
                await reserveAiRunBudgetTx(tx, { accountId: userId, runId: run.id });

                const taskData = body.tasks.map((task, index) => ({
                    runId: run.id,
                    seq: index + 1,
                    taskKey: task.taskKey,
                    title: task.title,
                    provider: task.provider,
                    model: normalizedTaskModels[index] ?? null,
                    prompt: task.prompt,
                    workingDirectory: task.workingDirectory,
                    permissionMode: task.permissionMode,
                    timeoutMs: task.timeoutMs,
                    targetMachineId: task.target?.type === 'machine_id'
                        ? task.target.machineId
                        : controllerMachineId,
                    dependsOnTaskKeys: task.dependsOn ?? [],
                    retryMaxAttempts: task.retry?.maxAttempts ?? DEFAULT_CONTEXT_RETRY_MAX_ATTEMPTS,
                    retryBackoffMs: task.retry?.backoffMs ?? DEFAULT_CONTEXT_RETRY_BACKOFF_MS,
                    nextAttemptAt: null,
                    status: 'queued',
                }));

                await tx.orchestratorTask.createMany({ data: taskData });

                const tasks = await tx.orchestratorTask.findMany({
                    where: { runId: run.id },
                    orderBy: { seq: 'asc' },
                    select: {
                        id: true,
                        seq: true,
                        taskKey: true,
                        title: true,
                        provider: true,
                        model: true,
                        workingDirectory: true,
                        dependsOnTaskKeys: true,
                        retryMaxAttempts: true,
                        retryBackoffMs: true,
                        nextAttemptAt: true,
                        status: true,
                        outputSummary: true,
                        outputText: true,
                        errorCode: true,
                        errorMessage: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                });

                return {
                    run: {
                        ...run,
                        tasks,
                    } as RunWithTasks,
                    summary: summarizeTasksByStatus(tasks),
                };
            });

            return reply.send({
                ok: true,
                data: {
                    runId: created.run.id,
                    mode: body.mode ?? 'async',
                    terminal: false,
                    run: {
                        status: created.run.status,
                        createdAt: created.run.createdAt.toISOString(),
                        updatedAt: created.run.updatedAt.toISOString(),
                        summary: created.summary,
                    },
                    tasks: created.run.tasks.map(task => mapTask(task)),
                    next: { hint: 'Await <orchestrator-callback>.', runId: created.run.id },
                },
            });
        } catch (error) {
            if (error instanceof AiBudgetExceeded) {
                return sendError(reply, 429, 'AI_BUDGET_EXCEEDED', 'AI budget limit exceeded');
            }
            request.log.error({ err: error }, 'orchestrator submit failed');
            if (body.idempotencyKey && isUniqueConstraintError(error)) {
                const duplicate = await loadExistingByIdempotencyWithRetry();
                if (duplicate) {
                    return reply.send({
                        ok: true,
                        data: {
                            runId: duplicate.run.id,
                            mode: body.mode ?? 'async',
                            terminal: isRunTerminal(duplicate.run.status),
                            run: {
                                status: duplicate.run.status,
                                createdAt: duplicate.run.createdAt.toISOString(),
                                updatedAt: duplicate.run.updatedAt.toISOString(),
                                summary: duplicate.summary,
                            },
                            tasks: duplicate.run.tasks.map(task => mapTask(task)),
                            next: isRunTerminal(duplicate.run.status) ? undefined : { hint: 'Await <orchestrator-callback>.', runId: duplicate.run.id },
                        },
                    });
                }
            }
            return sendError(reply, 500, 'INTERNAL', 'Failed to submit orchestrator run');
        }
    });

    app.get('/v1/orchestrator/runs/:runId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
            }),
            querystring: z.object({
                includeTasks: z.coerce.boolean().default(true),
                includeExecutions: z.coerce.boolean().default(false),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId } = request.params;
        const includeTasks = request.query?.includeTasks ?? true;
        const includeExecutions = includeTasks && (request.query?.includeExecutions ?? false);

        const loaded = await loadRunForUser(userId, runId, includeTasks, includeExecutions);
        if (!loaded) {
            return sendError(reply, 404, 'NOT_FOUND', 'Run not found');
        }

        const machineSet = new Set<string>(includeExecutions ? mapRunMachinesFromTasks(loaded.run) : []);
        if (machineSet.size === 0) {
            const groupedMachines = await db.orchestratorExecution.groupBy({
                by: ['machineId'],
                where: { runId: loaded.run.id },
            });
            for (const row of groupedMachines) {
                machineSet.add(row.machineId);
            }
        }

        return reply.send({
            ok: true,
            data: mapRunResponse(loaded.run, loaded.summary, includeTasks,
                [...machineSet], includeExecutions),
        });
    });

    app.get('/v1/orchestrator/runs/:runId/tasks/:taskId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
                taskId: z.string(),
            }),
            querystring: z.object({
                includeExecutions: z.coerce.boolean().default(false),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId, taskId } = request.params;
        const includeExecutions = request.query?.includeExecutions ?? false;

        const loadedTask = await loadTaskForUser(userId, runId, taskId, includeExecutions);
        if (!loadedTask) {
            return sendError(reply, 404, 'NOT_FOUND', 'Task not found');
        }

        return reply.send({
            ok: true,
            data: {
                run: {
                    runId: loadedTask.run.id,
                    title: loadedTask.run.title,
                    status: loadedTask.run.status,
                    updatedAt: loadedTask.run.updatedAt.toISOString(),
                },
                task: mapTask(loadedTask, loadedTask.run.metadata,
                    loadedTask.run.aiWorkItem, includeExecutions),
            },
        });
    });

    app.post('/v1/orchestrator/tasks/:taskId/send-message', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                taskId: z.string(),
            }),
            body: z.object({
                message: z.string().min(1).max(65_536),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { taskId } = request.params;
        const { message } = request.body;

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const task = await tx.orchestratorTask.findFirst({
                where: {
                    id: taskId,
                    run: {
                        accountId: userId,
                    },
                },
                select: {
                    id: true,
                    runId: true,
                    provider: true,
                    model: true,
                    timeoutMs: true,
                    status: true,
                    errorCode: true,
                    targetMachineId: true,
                    workingDirectory: true,
                    branchName: true,
                    baseCommit: true,
                    run: {
                        select: {
                            id: true,
                            controllerSessionId: true,
                        },
                    },
                },
            });

            if (!task) {
                return { kind: 'not_found' as const };
            }

            if (task.status !== 'completed' && task.status !== 'failed') {
                return { kind: 'invalid_state' as const, status: task.status };
            }
            if (isApprovalTerminalFailure(task.errorCode)) {
                return { kind: 'conflict' as const };
            }

            const sourceExecution = await tx.orchestratorExecution.findFirst({
                where: {
                    taskId: task.id,
                    childSessionId: { not: null },
                },
                orderBy: {
                    attempt: 'desc',
                },
                select: {
                    childSessionId: true,
                    machineId: true,
                    worktreePath: true,
                    branchName: true,
                    baseCommit: true,
                },
            });
            if (!sourceExecution?.childSessionId) {
                return { kind: 'missing_child_session' as const };
            }
            if ((task.targetMachineId && sourceExecution.machineId !== task.targetMachineId)
                || (task.workingDirectory && (!sourceExecution.worktreePath
                    || !sourceExecution.branchName || !sourceExecution.baseCommit
                    || sourceExecution.branchName !== task.branchName
                    || sourceExecution.baseCommit !== task.baseCommit))) {
                return { kind: 'workspace_identity_mismatch' as const };
            }

            const latestExecution = await tx.orchestratorExecution.findFirst({
                where: {
                    taskId: task.id,
                },
                orderBy: {
                    attempt: 'desc',
                },
                select: {
                    attempt: true,
                },
            });
            const attempt = (latestExecution?.attempt ?? 0) + 1;

            const movedTask = await tx.orchestratorTask.updateMany({
                where: {
                    id: task.id,
                    status: { in: ['completed', 'failed'] },
                },
                data: {
                    status: 'queued',
                    nextAttemptAt: null,
                    errorCode: null,
                    errorMessage: null,
                },
            });
            if (movedTask.count === 0) {
                return { kind: 'conflict' as const };
            }

            const execution = await tx.orchestratorExecution.create({
                data: {
                    runId: task.runId,
                    taskId: task.id,
                    machineId: sourceExecution.machineId,
                    provider: task.provider,
                    model: task.model ?? null,
                    childSessionId: sourceExecution.childSessionId,
                    executionType: 'resume',
                    resumeMessage: message,
                    status: 'queued',
                    attempt,
                    dispatchToken: randomUUID(),
                    timeoutMs: task.timeoutMs,
                },
                select: {
                    id: true,
                },
            });

            await tx.orchestratorRun.updateMany({
                where: { id: task.runId },
                data: {
                    status: 'running',
                    completedAt: null,
                },
            });

            return {
                kind: 'ok' as const,
                runId: task.runId,
                taskId: task.id,
                executionId: execution.id,
                controllerSessionId: task.run.controllerSessionId,
            };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Task not found');
        }
        if (result.kind === 'invalid_state') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} must be in completed/failed state to accept messages`);
        }
        if (result.kind === 'missing_child_session') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} has no child session id and cannot be resumed`);
        }
        if (result.kind === 'workspace_identity_mismatch') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} workspace identity changed and cannot be resumed`);
        }
        if (result.kind === 'conflict') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} is no longer resumable`);
        }

        void emitOrchestratorActivity(userId, result.controllerSessionId ?? null).catch(warn);

        return reply.send({
            ok: true,
            data: {
                accepted: true,
                runId: result.runId,
                taskId: result.taskId,
                executionId: result.executionId,
                next: { hint: 'Await <orchestrator-callback>.', runId: result.runId },
            },
        });
    });

    app.get('/v1/orchestrator/runs', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                status: z.enum(LIST_RUN_STATUS_FILTERS).optional(),
                controllerSessionId: z.string().min(1).max(128).optional(),
                limit: z.coerce.number().int().min(1).max(50).default(20),
                cursor: z.string().optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit ?? 20;
        const statusFilter = request.query?.status;
        const controllerSessionId = request.query?.controllerSessionId;
        const cursor = request.query?.cursor;

        let cursorParts: { createdAt: Date; id: string } | null = null;
        if (cursor) {
            cursorParts = decodeListCursor(cursor);
            if (!cursorParts) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'Invalid cursor');
            }
        }

        const resolvedStatuses = resolveRunStatusFilter(statusFilter);
        const where: any = {
            accountId: userId,
            ...(resolvedStatuses ? { status: { in: resolvedStatuses } } : {}),
            ...(controllerSessionId ? { controllerSessionId } : {}),
        };

        if (cursorParts) {
            where.OR = [
                { createdAt: { lt: cursorParts.createdAt } },
                {
                    AND: [
                        { createdAt: cursorParts.createdAt },
                        { id: { lt: cursorParts.id } },
                    ],
                },
            ];
        }

        const runs = await db.orchestratorRun.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            select: {
                id: true,
                title: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const hasNext = runs.length > limit;
        const page = hasNext ? runs.slice(0, limit) : runs;
        const runIds = page.map((run) => run.id);

        let summaryMap = new Map<string, RunSummary>();
        if (runIds.length > 0) {
            const grouped = await db.orchestratorTask.groupBy({
                by: ['runId', 'status'],
                where: { runId: { in: runIds } },
                _count: { _all: true },
            });
            summaryMap = summaryMapFromGrouped(grouped);
        }

        const machinesByRun = new Map<string, string[]>();
        if (runIds.length > 0) {
            const machineGroups = await db.orchestratorExecution.groupBy({
                by: ['runId', 'machineId'],
                where: { runId: { in: runIds } },
            });
            for (const row of machineGroups) {
                const existing = machinesByRun.get(row.runId) ?? [];
                existing.push(row.machineId);
                machinesByRun.set(row.runId, existing);
            }
        }

        const items = page.map((run: any) => ({
            runId: run.id,
            title: run.title,
            status: run.status,
            createdAt: run.createdAt.toISOString(),
            updatedAt: run.updatedAt.toISOString(),
            summary: summaryMap.get(run.id) ?? {
                total: 0,
                queued: 0,
                running: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
            },
            machines: machinesByRun.get(run.id) ?? [],
        }));

        let nextCursor: string | undefined;
        if (hasNext && page.length > 0) {
            const last = page[page.length - 1];
            nextCursor = encodeListCursor(last.createdAt, last.id);
        }

        return reply.send({
            ok: true,
            data: {
                items,
                nextCursor,
            },
        });
    });

    // ── Run status counts ──────────────────────────────────────────────
    app.get('/v1/orchestrator/runs/counts', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                controllerSessionId: z.string().min(1).max(128).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const controllerSessionId = request.query?.controllerSessionId;

        const grouped = await db.orchestratorRun.groupBy({
            by: ['status'],
            where: {
                accountId: userId,
                ...(controllerSessionId ? { controllerSessionId } : {}),
            },
            _count: { _all: true },
        });

        const counts: Record<string, number> = {};
        for (const row of grouped) {
            counts[row.status] = row._count._all;
        }

        return reply.send({ ok: true, data: counts });
    });

    app.get('/v1/orchestrator/runs/:runId/pend', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
            }),
            querystring: z.object({
                cursor: z.string().optional(),
                waitFor: z.enum(['change', 'terminal']).default('change'),
                timeoutMs: z.coerce.number().int().min(0).max(120_000).default(30_000),
                include: z.enum(['summary', 'all_tasks']).default('summary'),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId } = request.params;
        const waitFor = request.query?.waitFor ?? 'change';
        const timeoutMs = request.query?.timeoutMs ?? 30_000;
        const include = request.query?.include ?? 'summary';
        const previousCursor = request.query?.cursor;
        const includeTasks = include !== 'summary';

        const startedAtMs = Date.now();
        // v2.1 fallback: keep pend polling bounded and sparse to reduce DB pressure under concurrent long polls.
        // A future iteration should switch to event-driven wakeups.
        const maxPolls = Math.max(1, Math.ceil(timeoutMs / PEND_POLL_INTERVAL_MS) + 1);

        for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
            const loaded = await loadRunForUser(userId, runId, includeTasks);
            if (!loaded) {
                return sendError(reply, 404, 'NOT_FOUND', 'Run not found');
            }

            const terminal = isRunTerminal(loaded.run.status);
            const cursor = buildPendCursor({
                runId: loaded.run.id,
                updatedAt: loaded.run.updatedAt,
                status: loaded.run.status,
                summary: loaded.summary,
            });
            const changed = !previousCursor || previousCursor !== cursor;
            const waitSatisfied = waitFor === 'terminal' ? terminal : changed;
            const timeoutReached = Date.now() - startedAtMs >= timeoutMs;
            const isLastPoll = pollIndex >= maxPolls - 1;

            if (waitSatisfied || timeoutReached || isLastPoll) {
                return reply.send({
                    ok: true,
                    data: {
                        runId: loaded.run.id,
                        terminal,
                        changed,
                        cursor,
                        run: {
                            status: loaded.run.status,
                            summary: loaded.summary,
                            updatedAt: loaded.run.updatedAt.toISOString(),
                        },
                        ...(includeTasks ? { tasks: loaded.run.tasks.map(task => mapTask(task,
                            loaded.run.metadata, loaded.run.aiWorkItem)) } : {}),
                    },
                });
            }

            const elapsedMs = Date.now() - startedAtMs;
            const remainingMs = timeoutMs - elapsedMs;
            await delay(Math.min(PEND_POLL_INTERVAL_MS, Math.max(0, remainingMs)));
        }

        return sendError(reply, 500, 'INTERNAL', 'Pend polling exhausted unexpectedly');
    });

    app.post('/v1/orchestrator/runs/:runId/cancel', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
            }),
            body: z.object({
                reason: z.string().max(512).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId } = request.params;

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const run = await tx.orchestratorRun.findFirst({
                where: { id: runId, accountId: userId },
                select: { id: true, status: true, controllerSessionId: true },
            });
            if (!run) {
                return { kind: 'not_found' as const };
            }

            if (isRunTerminal(run.status)) {
                return { kind: 'ok' as const, status: run.status, controllerSessionId: run.controllerSessionId };
            }

            if (run.status !== 'canceling') {
                await tx.orchestratorRun.update({
                    where: { id: runId },
                    data: {
                        status: 'canceling',
                        cancelRequestedAt: new Date(),
                    },
                });
            }

            await tx.orchestratorTask.updateMany({
                where: {
                    runId,
                    status: 'queued',
                },
                data: {
                    status: 'cancelled',
                    errorCode: 'RUN_CANCELLED',
                    errorMessage: 'Cancelled before dispatch',
                    nextAttemptAt: null,
                },
            });
            await markDependencyFailedTasksInCancelTx(tx, runId);

            const grouped = await tx.orchestratorTask.groupBy({
                by: ['status'],
                where: { runId },
                _count: { _all: true },
            });

            const internal = createEmptySummaryInternal();
            for (const row of grouped) {
                addTaskCount(internal, row.status, row._count._all);
            }
            const nextStatus = deriveRunStatus('canceling', internal);
            if (nextStatus !== 'canceling') {
                await tx.orchestratorRun.update({
                    where: { id: runId },
                    data: {
                        status: nextStatus,
                        completedAt: new Date(),
                    },
                });
            }

            return { kind: 'ok' as const, status: nextStatus, controllerSessionId: run.controllerSessionId };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Run not found');
        }

        void emitOrchestratorActivity(userId, result.controllerSessionId ?? null).catch(warn);

        return reply.send({
            ok: true,
            data: {
                runId,
                status: result.status,
                accepted: true,
            },
        });
    });

    app.post('/v1/orchestrator/executions/:id/start', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            body: z.object({
                dispatchToken: z.string().min(1),
                startedAt: z.string().datetime().optional(),
                pid: z.number().int().optional(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const { dispatchToken, startedAt, pid } = request.body;

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const execution = await tx.orchestratorExecution.findFirst({
                where: {
                    id,
                    run: {
                        accountId: userId,
                    },
                },
                select: {
                    id: true,
                    status: true,
                    dispatchToken: true,
                    taskId: true,
                    runId: true,
                    run: {
                        select: {
                            status: true,
                            controllerSessionId: true,
                        },
                    },
                },
            });

            if (!execution) {
                return { kind: 'not_found' as const };
            }

            if (execution.dispatchToken !== dispatchToken) {
                return { kind: 'token_mismatch' as const };
            }

            if (isExecutionTerminal(execution.status)) {
                return { kind: 'duplicate' as const, status: execution.status };
            }

            if (execution.run.status === 'canceling' || execution.run.status === 'cancelled') {
                return { kind: 'ignored' as const, status: execution.status };
            }

            const startedAtDate = startedAt ? new Date(startedAt) : new Date();

            const updated = await tx.orchestratorExecution.updateMany({
                where: {
                    id,
                    status: 'dispatching',
                },
                data: {
                    status: 'running',
                    startedAt: startedAtDate,
                    pid,
                },
            });
            if (updated.count === 0) {
                return { kind: 'duplicate' as const };
            }

            const taskUpdated = await tx.orchestratorTask.updateMany({
                where: {
                    id: execution.taskId,
                    status: 'dispatching',
                },
                data: {
                    status: 'running',
                },
            });
            if (taskUpdated.count !== 1) throw new Error('Execution task owner changed');

            await tx.orchestratorRun.updateMany({
                where: {
                    id: execution.runId,
                    status: { in: ['queued', 'running'] },
                },
                data: {
                    status: 'running',
                },
            });

            return { kind: 'ok' as const, controllerSessionId: execution.run.controllerSessionId };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Execution not found');
        }
        if (result.kind === 'token_mismatch') {
            return sendError(reply, 409, 'CONFLICT', 'dispatchToken mismatch');
        }
        if (result.kind === 'duplicate') {
            return reply.send({ ok: true, data: { duplicate: true } });
        }
        if (result.kind === 'ignored') {
            return reply.send({ ok: true, data: { ignored: true } });
        }

        void emitOrchestratorActivity(userId, result.controllerSessionId ?? null).catch(warn);

        return reply.send({
            ok: true,
            data: { started: true },
        });
    });

    app.post('/v1/orchestrator/executions/:id/identity', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: z.object({
            dispatchToken: z.string().min(1), machineId: z.string().min(1),
            capability: z.string().regex(/^[0-9a-f]{64}$/).optional(),
            childSessionId: z.string().min(1).max(256),
            worktreePath: z.string().min(1).max(1024),
            branchName: z.string().min(1).max(256),
        }).strict() },
    }, async (request, reply) => {
        const body = request.body;
        const result = await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "OrchestratorExecution"
                WHERE id=${request.params.id} FOR UPDATE`;
            const execution = await tx.orchestratorExecution.findFirst({ where: {
                id: request.params.id, run: { accountId: request.userId },
            }, include: { task: { select: { targetMachineId: true,
                workingDirectory: true, branchName: true, baseCommit: true } },
            run: { select: { status: true, metadata: true } } } });
            if (!execution) return 'missing' as const;
            if (execution.dispatchToken !== body.dispatchToken
                || execution.machineId !== body.machineId) return 'conflict' as const;
            if (execution.capabilityProtocolVersion > 0 || body.capability) {
                if (!body.capability) return 'conflict' as const;
                try {
                    await assertExecutionCapabilityTx(tx, { accountId: request.userId,
                        executionId: execution.id, machineId: execution.machineId,
                        token: body.capability, operation: 'identity' });
                } catch { return 'conflict' as const; }
            }
            const latest = await tx.orchestratorExecution.findFirst({ where: {
                taskId: execution.taskId }, orderBy: { attempt: 'desc' }, select: { id: true } });
            if (latest?.id !== execution.id || execution.status !== 'running'
                || execution.run.status !== 'running'
                || execution.task.targetMachineId && execution.task.targetMachineId !== body.machineId
                || execution.task.branchName && execution.task.branchName !== body.branchName
                || execution.task.workingDirectory && !body.worktreePath.startsWith('/')) {
                return 'conflict' as const;
            }
            try {
                await loadDispatchProjectSnapshot(tx, { runId: execution.runId,
                    accountId: request.userId, metadata: execution.run.metadata,
                    taskMachineId: execution.task.targetMachineId,
                    taskDirectory: execution.task.workingDirectory,
                    taskBaseCommit: execution.task.baseCommit,
                    dispatchMachineId: execution.machineId });
            } catch { return 'conflict' as const; }
            const existing = [execution.childSessionId, execution.worktreePath, execution.branchName];
            if (existing.some(Boolean)) return existing[0] === body.childSessionId
                && existing[1] === body.worktreePath && existing[2] === body.branchName
                ? 'duplicate' as const : 'conflict' as const;
            const updated = await tx.orchestratorExecution.updateMany({ where: {
                id: execution.id, status: 'running', childSessionId: null,
                worktreePath: null, branchName: null,
            }, data: { childSessionId: body.childSessionId,
                worktreePath: body.worktreePath, branchName: body.branchName } });
            return updated.count ? 'bound' as const : 'conflict' as const;
        });
        if (result === 'missing') return sendError(reply, 404, 'NOT_FOUND', 'Execution not found');
        if (result === 'conflict') return sendError(reply, 409, 'CONFLICT', 'Execution identity changed');
        return reply.send({ ok: true, executionId: request.params.id,
            status: result, childSessionId: body.childSessionId,
            branchName: body.branchName });
    });

    app.post('/v1/orchestrator/executions/:id/finish', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            body: z.object({
                dispatchToken: z.string().min(1),
                status: z.enum(EXECUTION_FINAL_STATUSES),
                capability: z.string().regex(/^[0-9a-f]{64}$/).optional(),
                finishedAt: z.string().datetime().optional(),
                exitCode: z.number().int().nullable().optional(),
                signal: z.string().nullable().optional(),
                childSessionId: z.string().min(1).max(256).nullable().optional(),
                outputSummary: z.string().max(4096).nullable().optional(),
                outputText: z.string().max(1_000_000).nullable().optional(),
                finalResponse: z.string().max(65_536).nullable().optional(),
                errorCode: z.string().nullable().optional(),
                errorMessage: z.string().max(10_000).nullable().optional(),
                worktreePath: z.string().max(1024).nullable().optional(),
                branchName: z.string().max(256).nullable().optional(),
                baseCommit: z.string().max(128).nullable().optional(),
                commitSha: z.string().max(128).nullable().optional(),
                pullRequestUrl: z.string().url().max(2048).nullable().optional(),
                pullRequestNumber: z.number().int().positive().nullable().optional(),
                integrationProof: AiIntegrationProofSchema.optional(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const body = request.body;
        let verifiedDelivery: Awaited<ReturnType<typeof verifyGithubDeliveryMetadata>> = null;
        let deliveryWork: { id: string; sourceType: string; sourceResourceId: string } | null = null;
        if (body.status === 'completed') {
            const preflight = await db.orchestratorExecution.findFirst({ where: {
                id, dispatchToken: body.dispatchToken, status: { in: ['dispatching', 'running'] },
                run: { accountId: userId },
            }, select: { taskId: true, run: { select: { metadata: true } } } });
            const metadata = preflight?.run.metadata as { githubRepositoryId?: string | null } | null | undefined;
            const repositoryId = metadata?.githubRepositoryId;
            if (preflight) deliveryWork = await db.aiWorkItem.findFirst({ where: { accountId: userId,
                orchestratorTaskId: preflight.taskId }, select: { id: true, sourceType: true, sourceResourceId: true } });
            const authorizedRepository = preflight && deliveryWork && repositoryId && /^\d+$/.test(repositoryId)
                ? await db.aiGithubRepositoryGrant.findUnique({ where: {
                    accountId_repositoryId: { accountId: userId, repositoryId: BigInt(repositoryId!) },
                }, select: { repositoryId: true } }) : null;
            if (authorizedRepository && deliveryWork) {
                try {
                    verifiedDelivery = await verifyGithubDeliveryMetadata(userId,
                        body.finalResponse, body.branchName, body.commitSha,
                        authorizedRepository.repositoryId, deliveryWork.sourceType === 'github' ? deliveryWork.sourceResourceId : undefined);
                } catch {
                    warn({ module: 'orchestrator-delivery' }, 'GitHub delivery verification failed');
                }
            }
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT r.id FROM "OrchestratorRun" r
                JOIN "OrchestratorExecution" e ON e."runId"=r.id
                WHERE e.id=${id} AND r."accountId"=${userId} FOR UPDATE OF r`;
            const execution = await tx.orchestratorExecution.findFirst({
                where: {
                    id,
                    run: {
                        accountId: userId,
                    },
                },
                select: {
                    id: true,
                    status: true,
                    dispatchToken: true,
                    capabilityProtocolVersion: true,
                    runId: true,
                    taskId: true,
                    machineId: true,
                    attempt: true,
                    errorCode: true,
                    childSessionId: true,
                    worktreePath: true,
                    branchName: true,
                    run: {
                        select: {
                            status: true,
                            title: true,
                            controllerSessionId: true,
                            metadata: true,
                        },
                    },
                    task: {
                        select: {
                            targetMachineId: true,
                            workingDirectory: true,
                            baseCommit: true,
                            retryMaxAttempts: true,
                            retryBackoffMs: true,
                            collaborationRole: true,
                            dependsOnTaskKeys: true,
                        },
                    },
                },
            });

            if (!execution) {
                return { kind: 'not_found' as const };
            }

            if (execution.dispatchToken !== body.dispatchToken) {
                return { kind: 'token_mismatch' as const };
            }

            let recoveryDrain = false;
            if (execution.capabilityProtocolVersion > 0 || body.capability) {
                try {
                    if (!body.capability) return { kind: 'capability_invalid' as const };
                    const capabilityId = await assertExecutionCapabilityTx(tx, { accountId: userId,
                        executionId: id, machineId: execution.machineId,
                        token: body.capability, operation: 'finish' });
                    const capability = await tx.aiExecutionCapability.findUniqueOrThrow({ where: {
                        id: capabilityId }, select: { recoveryMode: true } });
                    recoveryDrain = capability.recoveryMode === 'drain';
                } catch { return { kind: 'capability_invalid' as const }; }
            }
            if (recoveryDrain && (body.status !== 'failed'
                || body.errorCode !== 'EXECUTION_CAPABILITY_EXPIRED'
                || body.exitCode === 0 || body.finalResponse || body.commitSha
                || body.pullRequestUrl || body.pullRequestNumber || body.integrationProof
                || (isExecutionTerminal(execution.status)
                    ? execution.status !== 'failed'
                        || execution.errorCode !== 'EXECUTION_CAPABILITY_EXPIRED'
                    : execution.run.status !== 'running'))) {
                return { kind: 'capability_invalid' as const };
            }
            if (isExecutionTerminal(execution.status)) {
                return { kind: 'duplicate' as const };
            }
            const runtimeContract = readAiRuntimeContract(execution.run.metadata);
            if (runtimeContract === 'invalid'
                || (runtimeContract && body.status === 'completed' && !body.finalResponse?.trim())) {
                return { kind: 'final_response_required' as const };
            }
            if (runtimeContract && execution.capabilityProtocolVersion !== 1) {
                return { kind: 'capability_invalid' as const };
            }
            if (execution.childSessionId && execution.worktreePath && execution.branchName
                && (body.childSessionId !== execution.childSessionId
                    || body.worktreePath !== execution.worktreePath
                    || body.branchName !== execution.branchName)) {
                return { kind: 'workspace_identity_mismatch' as const };
            }
            const cancelling = execution.run.status === 'canceling'
                || execution.run.status === 'cancelled';
            const executionStatus = cancelling ? 'cancelled' : body.status;
            if (!cancelling) try {
                const snapshot = await loadDispatchProjectSnapshot(tx, {
                    runId: execution.runId, accountId: userId, metadata: execution.run.metadata,
                    taskMachineId: execution.task.targetMachineId,
                    taskDirectory: execution.task.workingDirectory,
                    taskBaseCommit: execution.task.baseCommit,
                    dispatchMachineId: execution.machineId,
                });
                if (snapshot && executionStatus === 'completed' && body.baseCommit !== snapshot.baseCommit) {
                    return { kind: 'project_identity_invalid' as const };
                }
            } catch {
                return { kind: 'project_identity_invalid' as const };
            }

            let integrationExpected: Prisma.InputJsonValue | null = null;
            if (execution.task.collaborationRole === 'aggregate' && executionStatus === 'completed') {
                const proof = body.integrationProof;
                const members = await tx.orchestratorTask.findMany({ where: {
                    runId: execution.runId, collaborationRole: 'delegated',
                }, select: { id: true, taskKey: true, status: true, branchName: true,
                    commitSha: true, baseCommit: true, targetMachineId: true,
                    executions: { orderBy: { attempt: 'desc' }, take: 1,
                        select: { machineId: true } } } });
                const memberKeys = execution.task.dependsOnTaskKeys.filter((key) => key !== 'primary');
                if (!proof || !body.commitSha || proof.aggregateCommit !== body.commitSha
                    || members.length < 2 || members.length !== proof.members.length
                    || members.length !== memberKeys.length
                    || new Set(proof.members.map((member) => member.taskId)).size !== members.length
                    || members.some((member) => !member.taskKey || !memberKeys.includes(member.taskKey)
                        || member.status !== 'completed' || member.baseCommit !== proof.baseCommit
                        || !member.branchName || !member.commitSha
                        || !proof.members.some((claimed) => claimed.taskId === member.id
                            && claimed.branchName === member.branchName
                            && claimed.sourceCommit === member.commitSha))) {
                    return { kind: 'integration_invalid' as const };
                }
                integrationExpected = {
                    runId: execution.runId, taskId: execution.taskId, executionId: execution.id,
                    machineId: execution.machineId, aggregateCommit: body.commitSha!,
                    baseCommit: members[0].baseCommit!,
                    members: members.map((member) => ({ taskId: member.id,
                        machineId: member.executions[0]?.machineId ?? member.targetMachineId ?? execution.machineId,
                        branchName: member.branchName!, commitSha: member.commitSha!,
                        baseCommit: member.baseCommit! })),
                };
            }

            const finishedAt = body.finishedAt ? new Date(body.finishedAt) : new Date();
            const shouldRetry = !recoveryDrain
                && !isApprovalTerminalFailure(body.errorCode)
                && (executionStatus === 'failed' || executionStatus === 'timeout')
                && execution.run.status !== 'canceling'
                && execution.run.status !== 'cancelled'
                && execution.attempt < execution.task.retryMaxAttempts;
            const taskStatus = integrationExpected ? 'running' : shouldRetry
                ? 'queued'
                : executionStatus === 'completed'
                ? 'completed'
                : executionStatus === 'cancelled'
                    ? 'cancelled'
                    : 'failed';
            const nextAttemptAt = shouldRetry
                ? new Date(finishedAt.getTime() + execution.task.retryBackoffMs)
                : null;

            const updated = await tx.orchestratorExecution.updateMany({
                where: {
                    id,
                    status: { in: ['dispatching', 'running'] },
                },
                data: {
                    status: executionStatus,
                    finishedAt,
                    exitCode: body.exitCode ?? null,
                    signal: body.signal ?? null,
                    ...(body.childSessionId
                        ? { childSessionId: body.childSessionId }
                        : {}),
                    outputSummary: body.outputSummary ?? null,
                    outputText: body.outputText ?? null,
                    finalResponse: body.finalResponse ?? null,
                    errorCode: body.errorCode ?? null,
                    errorMessage: body.errorMessage ?? null,
                    worktreePath: execution.worktreePath ?? body.worktreePath ?? null,
                    branchName: execution.branchName ?? body.branchName ?? null,
                    baseCommit: body.baseCommit ?? null,
                    commitSha: body.commitSha ?? null,
                    pullRequestUrl: body.pullRequestUrl ?? null,
                    pullRequestNumber: body.pullRequestNumber ?? null,
                },
            });
            if (updated.count === 0) {
                return { kind: 'duplicate' as const };
            }

            const taskUpdated = await tx.orchestratorTask.updateMany({
                where: {
                    id: execution.taskId,
                    status: { in: ['dispatching', 'running'] },
                },
                data: {
                    status: taskStatus,
                    outputSummary: body.outputSummary ?? null,
                    outputText: body.outputText ?? null,
                    finalResponse: body.finalResponse ?? null,
                    errorCode: body.errorCode ?? null,
                    errorMessage: body.errorMessage ?? null,
                    worktreePath: execution.worktreePath ?? body.worktreePath ?? null,
                    branchName: execution.branchName ?? body.branchName ?? null,
                    baseCommit: body.baseCommit ?? null,
                    commitSha: body.commitSha ?? null,
                    pullRequestUrl: body.pullRequestUrl ?? null,
                    pullRequestNumber: body.pullRequestNumber ?? null,
                    nextAttemptAt,
                },
            });
            if (taskUpdated.count !== 1) throw new Error('Execution task owner changed');
            if (isApprovalTerminalFailure(body.errorCode) && executionStatus === 'failed') {
                await tx.aiDecisionRequest.updateMany({ where: {
                    executionId: execution.id, status: 'pending',
                }, data: { status: 'expired', version: { increment: 1 } } });
                await tx.aiDecisionRequest.updateMany({ where: {
                    executionId: execution.id, deliveryStatus: { notIn: ['blocked', 'delivered'] },
                }, data: { deliveryStatus: 'blocked', claimOwner: null,
                    leaseUntil: null, errorCode: body.errorCode } });
            }
            if (integrationExpected && body.integrationProof) {
                const expectedHash = integrationExpectedHash(integrationExpected);
                await tx.aiIntegrationVerification.create({ data: {
                    executionId: execution.id, accountId: userId, runId: execution.runId,
                    taskId: execution.taskId, machineId: execution.machineId,
                    proof: body.integrationProof as Prisma.InputJsonValue,
                    expected: integrationExpected, expectedHash, status: 'pending',
                } });
            }

            // Coordinator chat runs deliberately have no AiWorkItem. Persist
            // the runtime's actual answer as an agent chat message when the
            // turn completes, so the client sees a real response rather than
            // an immediate echo of the user's text.
            const coordinatorMetadata = execution.run.metadata as {
                coordinatorChat?: boolean;
                conversationId?: string;
                aiAgentId?: string;
            } | null;
            if (coordinatorMetadata?.coordinatorChat
                && coordinatorMetadata.conversationId
                && executionStatus === 'completed') {
                const answer = body.finalResponse?.trim() ?? '';
                if (answer) {
                    const conversation = await tx.aiConversation.findFirst({ where: {
                        id: coordinatorMetadata.conversationId, accountId: userId,
                        agent: { accountId: userId },
                        ...(coordinatorMetadata.aiAgentId ? {
                            OR: [
                                { kind: 'direct', agentId: coordinatorMetadata.aiAgentId },
                                { kind: 'group', team: { accountId: userId, members: {
                                    some: { agentId: coordinatorMetadata.aiAgentId, agent: { accountId: userId } },
                                } } },
                            ],
                        } : { id: '__missing_agent__' }),
                    }, select: { id: true } });
                    if (conversation) {
                    const payload = {
                        id: `coordinator-reply-${execution.id}`,
                        kind: 'text' as const,
                        sender: 'agent' as const,
                        ...(coordinatorMetadata.aiAgentId ? { agentId: coordinatorMetadata.aiAgentId } : {}),
                        text: answer,
                        timeLabel: finishedAt.toISOString(),
                    };
                    await tx.aiMessage.create({ data: {
                        id: payload.id,
                        conversationId: coordinatorMetadata.conversationId,
                        sender: 'agent',
                        agentId: coordinatorMetadata.aiAgentId ?? null,
                        payload: payload as Prisma.InputJsonValue,
                    } });
                    await tx.aiConversation.update({ where: { id: coordinatorMetadata.conversationId }, data: { updatedAt: finishedAt } });
                    }
                }
            }

            if (!cancelling && verifiedDelivery && deliveryWork && !integrationExpected) {
                await tx.aiWorkItem.updateMany({
                    where: { id: deliveryWork.id, orchestratorTaskId: execution.taskId, accountId: userId,
                        OR: [{ sourceType: 'execution' }, { sourceResourceId: verifiedDelivery.issue.resourceId }] },
                    data: {
                        sourceType: 'github', sourceLabel: verifiedDelivery.issue.label,
                        sourceResourceId: verifiedDelivery.issue.resourceId,
                        pullRequestUrl: verifiedDelivery.pullRequest.url,
                        pullRequestNumber: verifiedDelivery.pullRequest.number,
                        pullRequestState: verifiedDelivery.state,
                        deliveryVerificationStatus: 'verified', deliveryVerifiedAt: finishedAt,
                        deliveryVerificationNextAt: null, deliveryVerificationErrorCode: null,
                        requiresDecision: true,
                        ...(verifiedDelivery.mergedAt ? { pullRequestMergedAt: verifiedDelivery.mergedAt } : {}),
                    },
                });
            } else if (deliveryWork && executionStatus === 'completed') {
                await tx.aiWorkItem.updateMany({ where: { id: deliveryWork.id, accountId: userId },
                    data: { deliveryVerificationStatus: 'pending',
                        deliveryVerificationNextAt: new Date(finishedAt.getTime() + 30_000),
                        deliveryVerificationErrorCode: 'unverified', requiresDecision: true } });
            }

            const grouped = await tx.orchestratorTask.groupBy({
                by: ['status'],
                where: { runId: execution.runId },
                _count: { _all: true },
            });
            const internal = createEmptySummaryInternal();
            for (const row of grouped) {
                addTaskCount(internal, row.status, row._count._all);
            }

            const nextRunStatus = deriveRunStatus(execution.run.status, internal);
            await tx.orchestratorRun.update({
                where: { id: execution.runId },
                data: {
                    status: nextRunStatus,
                    completedAt: isRunTerminal(nextRunStatus) ? finishedAt : null,
                },
            });

            return {
                kind: 'ok' as const,
                runId: execution.runId,
                runTitle: execution.run.title ?? null,
                runStatus: nextRunStatus,
                controllerSessionId: execution.run.controllerSessionId,
                summary: toPublicSummary(internal),
            };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Execution not found');
        }
        if (result.kind === 'integration_invalid') {
            return sendError(reply, 409, 'INTEGRATION_INVALID', 'Aggregate integration proof does not match completed members');
        }
        if (result.kind === 'final_response_required') {
            return sendError(reply, 409, 'STRUCTURED_FINAL_REQUIRED',
                'Completed AI execution requires a structured final response');
        }
        if (result.kind === 'project_identity_invalid') {
            return sendError(reply, 409, 'PROJECT_IDENTITY_INVALID', 'Execution does not match the project snapshot');
        }
        if (result.kind === 'workspace_identity_mismatch') {
            return sendError(reply, 409, 'WORKSPACE_IDENTITY_MISMATCH', 'Execution workspace identity changed');
        }
        if (result.kind === 'token_mismatch') {
            return sendError(reply, 409, 'CONFLICT', 'dispatchToken mismatch');
        }
        if (result.kind === 'capability_invalid') {
            return sendError(reply, 409, 'CAPABILITY_INVALID', 'Execution capability is unavailable');
        }
        if (result.kind === 'duplicate') {
            return reply.send({ ok: true, data: { duplicate: true } });
        }

        void emitOrchestratorActivity(userId, result.controllerSessionId ?? null).catch(warn);
        if (isRunTerminal(result.runStatus) && result.controllerSessionId) {
            const delivery = eventRouter.emitEphemeral({
                userId,
                payload: buildOrchestratorRunTerminalEphemeral(
                    result.runId,
                    result.runStatus,
                    result.runTitle ?? 'Untitled run',
                ),
                recipientFilter: {
                    type: 'all-interested-in-session',
                    sessionId: result.controllerSessionId,
                },
            });
            const sessionOnline = delivery.sessionScoped > 0 ||
                await hasSessionPresence(userId, result.controllerSessionId).catch(error => {
                    warn(error);
                    return false;
                });
            if (!sessionOnline) {
                const title = result.runTitle ?? 'Untitled run';
                const s = result.summary;
                const parts: string[] = [
                    `Status: ${result.runStatus}`,
                    `Tasks: ${s.total} total — ${s.completed} completed, ${s.failed} failed, ${s.cancelled} cancelled`,
                    `Run ID: ${result.runId}`,
                ];
                void inTx(async (tx) => {
                    await feedPost(tx, Context.create(userId), {
                        kind: 'notice',
                        title,
                        text: parts.join('\n'),
                    }, null, true, {
                        links: [{ label: 'Run Details', url: `/orchestrator/${result.runId}` }],
                    });
                }).catch(warn);
            }
        }

        return reply.send({
            ok: true,
            data: {
                finished: true,
                runStatus: result.runStatus,
            },
        });
    });

    app.get('/v1/orchestrator/activity', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                controllerSessionId: z.string().min(1),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { controllerSessionId } = request.query;

        const [activity, totalRunCount] = await Promise.all([
            queryOrchestratorSessionActivity(userId, controllerSessionId),
            db.orchestratorRun.count({
                where: { accountId: userId, controllerSessionId },
            }),
        ]);
        return reply.send({ ok: true, data: { activity, totalRunCount } });
    });

    app.get('/v1/orchestrator/activity/batch', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const [rows, totalRows] = await Promise.all([
            db.orchestratorTask.findMany({
                where: {
                    run: {
                        accountId: userId,
                        controllerSessionId: { not: null },
                        status: { in: ['queued', 'running', 'canceling'] },
                    },
                    status: { in: ['queued', 'dispatching', 'running'] },
                },
                select: {
                    id: true,
                    runId: true,
                    run: {
                        select: {
                            controllerSessionId: true,
                        },
                    },
                },
            }),
            db.orchestratorRun.groupBy({
                by: ['controllerSessionId'],
                where: {
                    accountId: userId,
                    controllerSessionId: { not: null },
                },
                _count: { _all: true },
            }),
        ]);

        const totalRunCounts: Record<string, number> = {};
        for (const row of totalRows) {
            if (row.controllerSessionId) {
                totalRunCounts[row.controllerSessionId] = row._count._all;
            }
        }

        const activity: Record<string, Record<string, string[]>> = {};
        for (const row of rows) {
            const controllerSessionId = row.run.controllerSessionId;
            if (!controllerSessionId) {
                continue;
            }
            if (!activity[controllerSessionId]) {
                activity[controllerSessionId] = {};
            }
            if (!activity[controllerSessionId][row.runId]) {
                activity[controllerSessionId][row.runId] = [];
            }
            activity[controllerSessionId][row.runId].push(row.id);
        }

        return reply.send({ ok: true, data: { activity, totalRunCounts } });
    });
}
