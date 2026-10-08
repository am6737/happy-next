import { db } from "@/storage/db";
import { invokeUserRpc, listConnectedUserRpcMethods } from "@/app/api/socket/rpcRegistry";
import { log, warn } from "@/utils/log";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { shutdownSignal } from "@/utils/shutdown";
import { randomUUID } from "node:crypto";
import { Prisma } from '@prisma/client';
import { loadDispatchProjectSnapshot, ProjectSnapshotInvalidError,
    type DispatchProjectSnapshot } from '@/app/ai/projectSnapshot';
import { isLegacyCoordinator, readAiRuntimeContract,
    type AiRuntimeContract } from '@/app/ai/runtimeContract';
import { AiRuntimeFeaturesSchema } from 'happy-wire';
import { provisionDispatchCapability } from '@/app/ai/workspaceAuth';
import {
    addTaskCount,
    createEmptySummaryInternal,
    deriveRunStatus,
    isRunTerminal,
} from "./state";

const coordinatorRuntimeFeaturesSchema = AiRuntimeFeaturesSchema.omit({ deliveryProofVersion: true });
const ACTIVE_RUN_STATUSES = ['queued', 'running', 'canceling'];
const ACTIVE_EXECUTION_STATUSES = ['dispatching', 'running'];

// Main scheduler loop interval: scans active runs for dispatch and timeout every tick
export const ORCHESTRATOR_SCHEDULER_INTERVAL_MS = 1_000;
// RPC call timeout: max wait when sending dispatch/cancel commands to target machines
export const ORCHESTRATOR_RPC_TIMEOUT_MS = 15_000;
// Stale dispatch detection: executions stuck in 'dispatching' beyond this are marked failed
export const ORCHESTRATOR_DISPATCH_STALE_MS = 60_000;
export const ORCHESTRATOR_CANCEL_GRACE_MS = 60_000;
// Daemon watchdog runs at timeoutMs; allow process-tree termination and its durable finish report.
export const ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS = 60_000;
// Default task timeout: fallback when user does not set timeoutMs (24 hours)
export const ORCHESTRATOR_DEFAULT_TASK_TIMEOUT_MS = 24 * 60 * 60_000;

export type SchedulerAction =
    | {
        type: 'dispatch';
        accountId: string;
        machineId: string;
        runId: string;
        taskId: string;
        executionId: string;
        dispatchToken: string;
        payload: {
            executionId: string;
            runId: string;
            taskId: string;
            dispatchToken: string;
            provider: string;
            executionType: 'initial' | 'resume';
            childSessionId?: string;
            model?: string;
            prompt: string;
            timeoutMs: number;
            workingDirectory?: string;
            permissionMode?: 'read_only' | 'approval' | 'guarded_auto';
            assignedAgentId?: string;
            parentTaskId?: string;
            teamId?: string;
            delegationDepth?: number;
            integrationPolicy?: 'review_and_cherry_pick';
            projectId?: string;
            projectSnapshot?: DispatchProjectSnapshot;
            aiRuntimeContract?: AiRuntimeContract;
            aiRuntimeContractInvalid?: boolean;
            internalAi?: boolean;
            executionCapability?: { token: string; protocolVersion: 1;
                allowedOps: string[]; expiresAt: string };
        };
    }
    | {
        type: 'cancel';
        accountId: string;
        machineId: string;
        runId: string;
        taskId: string;
        executionId: string;
        dispatchToken: string;
        payload: {
            executionId: string;
            runId: string;
            taskId: string;
            dispatchToken: string;
        };
    };

async function recomputeRunStatusTx(tx: any, runId: string, currentStatus: string, completedAt: Date | null, now: Date): Promise<string> {
    const grouped = await tx.orchestratorTask.groupBy({
        by: ['status'],
        where: { runId },
        _count: { _all: true },
    });
    const internal = createEmptySummaryInternal();
    for (const row of grouped) {
        addTaskCount(internal, row.status, row._count._all);
    }

    const nextStatus = deriveRunStatus(currentStatus, internal);
    const shouldUpdateCompletedAt = isRunTerminal(nextStatus) && !completedAt;
    if (nextStatus !== currentStatus || shouldUpdateCompletedAt) {
        await tx.orchestratorRun.update({
            where: { id: runId },
            data: {
                status: nextStatus,
                completedAt: isRunTerminal(nextStatus) ? now : null,
            },
        });
    }
    return nextStatus;
}

class UpgradeRequiredError extends Error {
    constructor() { super('Machine does not support the frozen AI runtime contract'); }
}

async function markDispatchFailed(action: Extract<SchedulerAction, { type: 'dispatch' }>, reason: string,
    upgradeRequired = false): Promise<void> {
    const now = new Date();
    await db.$transaction(async (tx: any) => {
        const execution = await tx.orchestratorExecution.findUnique({
            where: { id: action.executionId },
            select: {
                id: true,
                status: true,
                runId: true,
                taskId: true,
                attempt: true,
            },
        });
        if (!execution || execution.status !== 'dispatching') {
            return;
        }

        const run = await tx.orchestratorRun.findUnique({
            where: { id: action.runId },
            select: { status: true, completedAt: true },
        });
        if (!run) {
            return;
        }
        const task = await tx.orchestratorTask.findUnique({
            where: { id: action.taskId },
            select: {
                retryMaxAttempts: true,
                retryBackoffMs: true,
            },
        });
        const shouldRetry = !upgradeRequired && !!task
            && run.status !== 'canceling'
            && run.status !== 'cancelled'
            && execution.attempt < task.retryMaxAttempts;
        const nextAttemptAt = shouldRetry
            ? new Date(now.getTime() + task.retryBackoffMs)
            : null;

        await tx.orchestratorExecution.update({
            where: { id: action.executionId },
            data: {
                status: 'failed',
                finishedAt: now,
                errorCode: upgradeRequired ? 'UPGRADE_REQUIRED' : 'RPC_DISPATCH_FAILED',
                errorMessage: reason,
            },
        });
        await tx.orchestratorTask.updateMany({
            where: { id: action.taskId, status: 'dispatching' },
            data: {
                status: shouldRetry ? 'queued' : 'failed',
                errorCode: upgradeRequired ? 'UPGRADE_REQUIRED' : 'RPC_DISPATCH_FAILED',
                errorMessage: reason,
                nextAttemptAt,
            },
        });
        await recomputeRunStatusTx(tx, action.runId, run.status, run.completedAt, now);
    });
}

export async function executeSchedulerActions(actions: SchedulerAction[]): Promise<void> {
    for (const action of actions) {
        if (action.type === 'dispatch') {
            try {
                const featureMethod = `${action.machineId}:orchestrator-features`;
                const hasFeatures = listConnectedUserRpcMethods(action.accountId).includes(featureMethod);
                const aiWorkItem = await db.aiWorkItem.findFirst({ where: {
                    orchestratorRunId: action.runId, accountId: action.accountId,
                }, select: { id: true } });
                const internalAi = !!aiWorkItem || !!action.payload.internalAi;
                if ((internalAi || action.payload.permissionMode === 'approval') && !hasFeatures) {
                    throw new UpgradeRequiredError();
                }
                if (hasFeatures) {
                    const nonce = randomUUID();
                    let features: any;
                    try {
                        features = await invokeUserRpc(action.accountId, featureMethod,
                            { nonce, protocolVersion: 1 }, 3_000);
                    } catch {
                        throw new UpgradeRequiredError();
                    }
                    if (features?.nonce !== nonce || features?.machineId !== action.machineId
                        || features?.protocolVersion !== 1
                        || features?.executionCapabilityVersion !== 1) {
                        throw new UpgradeRequiredError();
                    }
                    const contract = action.payload.aiRuntimeContract;
                    const requiredFeatures = contract?.kind === 'coordinator'
                        ? coordinatorRuntimeFeaturesSchema : AiRuntimeFeaturesSchema;
                    if (action.payload.aiRuntimeContractInvalid
                        || (internalAi && contract && !requiredFeatures.safeParse(features).success)) {
                        throw new UpgradeRequiredError();
                    }
                    if (action.payload.permissionMode === 'approval'
                        && (features?.approval?.provider !== 'codex'
                            || features?.approval?.runner !== 'app-server'
                            || features?.approval?.operationDecisionVersion !== 1)) {
                        throw new UpgradeRequiredError();
                    }
                    action.payload.executionCapability = await provisionDispatchCapability({
                        accountId: action.accountId, executionId: action.executionId,
                        dispatchToken: action.dispatchToken, machineId: action.machineId,
                        timeoutMs: action.payload.timeoutMs,
                    });
                }
                await invokeUserRpc(
                    action.accountId,
                    `${action.machineId}:orchestrator-dispatch`,
                    action.payload,
                    ORCHESTRATOR_RPC_TIMEOUT_MS,
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                warn({ module: 'orchestrator-scheduler', runId: action.runId, executionId: action.executionId }, `Dispatch RPC failed: ${message}`);
                try {
                    await markDispatchFailed(action, message, error instanceof UpgradeRequiredError);
                } catch (markError) {
                    const markMessage = markError instanceof Error ? markError.message : String(markError);
                    warn(
                        { module: 'orchestrator-scheduler', runId: action.runId, executionId: action.executionId },
                        `markDispatchFailed failed: ${markMessage}`,
                    );
                }
            }
            continue;
        }

        try {
            await invokeUserRpc(
                action.accountId,
                `${action.machineId}:orchestrator-cancel`,
                action.payload,
                ORCHESTRATOR_RPC_TIMEOUT_MS,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn({ module: 'orchestrator-scheduler', runId: action.runId, executionId: action.executionId }, `Cancel RPC failed: ${message}`);
        }
    }
}

async function failStaleDispatchingExecutionsTx(tx: any, runId: string, runStatus: string, now: Date): Promise<void> {
    const staleBefore = new Date(now.getTime() - ORCHESTRATOR_DISPATCH_STALE_MS);
    const staleExecutions = await tx.orchestratorExecution.findMany({
        where: {
            runId,
            status: 'dispatching',
            createdAt: { lt: staleBefore },
        },
        select: {
            id: true,
            taskId: true,
            attempt: true,
            task: {
                select: {
                    retryMaxAttempts: true,
                    retryBackoffMs: true,
                },
            },
        },
    });

    for (const execution of staleExecutions) {
        const shouldRetry = runStatus !== 'canceling'
            && runStatus !== 'cancelled'
            && execution.attempt < execution.task.retryMaxAttempts;
        const nextAttemptAt = shouldRetry
            ? new Date(now.getTime() + execution.task.retryBackoffMs)
            : null;
        const updated = await tx.orchestratorExecution.updateMany({
            where: {
                id: execution.id,
                status: 'dispatching',
            },
            data: {
                status: 'failed',
                finishedAt: now,
                errorCode: 'DISPATCH_TIMEOUT',
                errorMessage: 'Dispatch did not start in time',
            },
        });
        if (updated.count === 0) {
            continue;
        }
        warn({ module: 'orchestrator-scheduler', runId, executionId: execution.id, taskId: execution.taskId }, `Stale dispatch detected: execution stuck in 'dispatching' for >${ORCHESTRATOR_DISPATCH_STALE_MS}ms, marking failed (retry=${shouldRetry})`);
        await tx.orchestratorTask.updateMany({
            where: { id: execution.taskId, status: 'dispatching' },
            data: {
                status: shouldRetry ? 'queued' : 'failed',
                errorCode: 'DISPATCH_TIMEOUT',
                errorMessage: 'Dispatch did not start in time',
                nextAttemptAt,
            },
        });
    }
}

export async function failTimedOutRunningExecutionsTx(tx: any, runId: string, now: Date): Promise<void> {
    const runningExecutions = await tx.orchestratorExecution.findMany({
        where: {
            runId,
            status: 'running',
        },
        select: {
            id: true,
            taskId: true,
            startedAt: true,
            createdAt: true,
            timeoutMs: true,
        },
    });

    for (const execution of runningExecutions) {
        const timeoutMs = execution.timeoutMs ?? ORCHESTRATOR_DEFAULT_TASK_TIMEOUT_MS;
        const startedAt = execution.startedAt ?? execution.createdAt;
        if (now.getTime() - startedAt.getTime() < timeoutMs + ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS) {
            continue;
        }

        const updated = await tx.orchestratorExecution.updateMany({
            where: {
                id: execution.id,
                status: 'running',
            },
            data: {
                status: 'timeout',
                finishedAt: now,
                errorCode: 'TASK_TIMEOUT',
                errorMessage: `Task exceeded timeout (${timeoutMs}ms)`,
            },
        });
        if (updated.count === 0) {
            continue;
        }

        // A missing watchdog report does not prove the provider process has stopped.
        // Only a fenced daemon finish may apply the configured retry policy.
        warn({ module: 'orchestrator-scheduler', runId, executionId: execution.id, taskId: execution.taskId }, `Execution watchdog report absent after ${timeoutMs + ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS}ms`);
        await tx.orchestratorTask.updateMany({
            where: { id: execution.taskId, status: 'running' },
            data: {
                status: 'failed',
                errorCode: 'TASK_TIMEOUT',
                errorMessage: `Task watchdog report absent after timeout (${timeoutMs}ms)`,
                nextAttemptAt: null,
            },
        });
    }
}

async function buildRunActions(run: {
    id: string;
    accountId: string;
    status: string;
    maxConcurrency: number;
}, now: Date): Promise<SchedulerAction[]> {
    const actions: SchedulerAction[] = [];
    const routableMachineIds = new Set(listConnectedUserRpcMethods(run.accountId)
        .filter((method) => method.endsWith(':orchestrator-dispatch'))
        .map((method) => method.slice(0, -':orchestrator-dispatch'.length)));
    await db.$transaction(async (tx: any) => {
        const currentRun = await tx.orchestratorRun.findUnique({
            where: { id: run.id },
            select: {
                id: true,
                accountId: true,
                status: true,
                maxConcurrency: true,
                completedAt: true,
                cancelRequestedAt: true,
                metadata: true,
            },
        });
        if (!currentRun || isRunTerminal(currentRun.status)) {
            return;
        }

        await failStaleDispatchingExecutionsTx(tx, currentRun.id, currentRun.status, now);
        await failTimedOutRunningExecutionsTx(tx, currentRun.id, now);

        if (currentRun.status === 'canceling' && currentRun.cancelRequestedAt) {
            if (now.getTime() - currentRun.cancelRequestedAt.getTime()
                >= ORCHESTRATOR_CANCEL_GRACE_MS) {
                await tx.orchestratorExecution.updateMany({ where: { runId: currentRun.id,
                    status: { in: ['queued', 'dispatching', 'running'] } },
                data: { status: 'cancelled', finishedAt: now,
                    errorCode: 'CANCEL_ACK_TIMEOUT' } });
                await tx.orchestratorTask.updateMany({ where: { runId: currentRun.id,
                    status: { in: ['queued', 'dispatching', 'running'] } },
                data: { status: 'cancelled', errorCode: 'CANCEL_ACK_TIMEOUT',
                    nextAttemptAt: null } });
                await recomputeRunStatusTx(tx, currentRun.id, currentRun.status,
                    currentRun.completedAt, now);
                return;
            }
        }

        if (currentRun.status === 'canceling') {
            await tx.orchestratorTask.updateMany({
                where: {
                    runId: currentRun.id,
                    status: 'queued',
                },
                data: {
                    status: 'cancelled',
                    errorCode: 'RUN_CANCELLED',
                    errorMessage: 'Cancelled before dispatch',
                    nextAttemptAt: null,
                },
            });

            const activeExecutions = await tx.orchestratorExecution.findMany({
                where: {
                    runId: currentRun.id,
                    status: { in: ACTIVE_EXECUTION_STATUSES },
                },
                select: {
                    id: true,
                    runId: true,
                    taskId: true,
                    machineId: true,
                    dispatchToken: true,
                },
            });
            for (const execution of activeExecutions) {
                actions.push({
                    type: 'cancel',
                    accountId: currentRun.accountId,
                    machineId: execution.machineId,
                    runId: execution.runId,
                    taskId: execution.taskId,
                    executionId: execution.id,
                    dispatchToken: execution.dispatchToken,
                    payload: {
                        executionId: execution.id,
                        runId: execution.runId,
                        taskId: execution.taskId,
                        dispatchToken: execution.dispatchToken,
                    },
                });
            }
        } else {
            const activeExecutionCount = await tx.orchestratorExecution.count({
                where: {
                    runId: currentRun.id,
                    status: { in: ACTIVE_EXECUTION_STATUSES },
                },
            });
            const slots = Math.max(0, currentRun.maxConcurrency - activeExecutionCount);
            if (slots > 0) {
                const queuedTasks = await tx.orchestratorTask.findMany({
                    where: {
                        runId: currentRun.id,
                        status: 'queued',
                        OR: [
                            { nextAttemptAt: null },
                            { nextAttemptAt: { lte: now } },
                        ],
                    },
                    orderBy: { seq: 'asc' },
                    select: {
                        id: true,
                        runId: true,
                        taskKey: true,
                        dependsOnTaskKeys: true,
                        provider: true,
                        model: true,
                        prompt: true,
                        workingDirectory: true,
                        permissionMode: true,
                        timeoutMs: true,
                        targetMachineId: true,
                        baseCommit: true,
                        collaborationRole: true,
                        assignedAgentId: true,
                        parentTaskId: true,
                        delegationDepth: true,
                        nextAttemptAt: true,
                    },
                });
                const queuedExecutions = await tx.orchestratorExecution.findMany({
                    where: {
                        runId: currentRun.id,
                        status: 'queued',
                    },
                    orderBy: {
                        attempt: 'desc',
                    },
                    select: {
                        id: true,
                        runId: true,
                        taskId: true,
                        machineId: true,
                        provider: true,
                        model: true,
                        status: true,
                        attempt: true,
                        dispatchToken: true,
                        timeoutMs: true,
                        executionType: true,
                        childSessionId: true,
                        resumeMessage: true,
                    },
                });
                const queuedExecutionByTaskId = new Map<string, typeof queuedExecutions[number]>();
                for (const execution of queuedExecutions) {
                    if (!queuedExecutionByTaskId.has(execution.taskId)) {
                        queuedExecutionByTaskId.set(execution.taskId, execution);
                    }
                }
                const keyedTasks = await tx.orchestratorTask.findMany({
                    where: {
                        runId: currentRun.id,
                        taskKey: { not: null },
                    },
                    select: {
                        taskKey: true,
                        status: true,
                        outputSummary: true,
                        commitSha: true,
                        branchName: true,
                        baseCommit: true,
                        collaborationRole: true,
                    },
                });
                const taskKeyToStatus = new Map<string, string>();
                const taskKeyToResult = new Map<string, typeof keyedTasks[number]>();
                for (const keyedTask of keyedTasks) {
                    if (keyedTask.taskKey) {
                        taskKeyToStatus.set(keyedTask.taskKey, keyedTask.status);
                        taskKeyToResult.set(keyedTask.taskKey, keyedTask);
                    }
                }
                const readyTasks: typeof queuedTasks = [];
                for (const task of queuedTasks) {
                    const dependencies = task.dependsOnTaskKeys ?? [];
                    if (dependencies.length === 0) {
                        readyTasks.push(task);
                        continue;
                    }

                    let dependencyFailedMessage: string | null = null;
                    let blocked = false;
                    for (const dependencyKey of dependencies) {
                        const dependencyStatus = taskKeyToStatus.get(dependencyKey);
                        if (!dependencyStatus) {
                            dependencyFailedMessage = `Dependency not found: ${dependencyKey}`;
                            break;
                        }
                        if (dependencyStatus === 'failed' || dependencyStatus === 'cancelled' || dependencyStatus === 'dependency_failed') {
                            dependencyFailedMessage = `Dependency failed: ${dependencyKey}`;
                            break;
                        }
                        if (dependencyStatus !== 'completed') {
                            blocked = true;
                        }
                    }

                    if (dependencyFailedMessage) {
                        await tx.orchestratorTask.updateMany({
                            where: { id: task.id, status: 'queued' },
                            data: {
                                status: 'dependency_failed',
                                errorCode: 'DEPENDENCY_FAILED',
                                errorMessage: dependencyFailedMessage,
                                nextAttemptAt: null,
                            },
                        });
                        continue;
                    }

                    if (!blocked) {
                        if (task.collaborationRole === 'aggregate') {
                            const delegated = dependencies.map((key: string) => taskKeyToResult.get(key))
                                .filter((item: any) => item?.collaborationRole === 'delegated');
                            const branches = new Set<string>();
                            const bases = new Set<string>();
                            const invalid = delegated.some((item: any) => {
                                if (!item?.branchName || !/^[0-9a-f]{40}$/i.test(item.commitSha ?? '')
                                    || !/^[0-9a-f]{40}$/i.test(item.baseCommit ?? '')
                                    || branches.has(item.branchName)) return true;
                                branches.add(item.branchName);
                                bases.add(item.baseCommit);
                                return false;
                            }) || bases.size > 1;
                            if (invalid) {
                                await tx.orchestratorTask.updateMany({ where: { id: task.id, status: 'queued' },
                                    data: { status: 'dependency_failed', errorCode: 'INVALID_CHILD_DELIVERY',
                                        errorMessage: 'Delegated commits lack independent branch or shared base identity' } });
                                continue;
                            }
                        }
                        readyTasks.push(task);
                    }
                }

                const targetMachineIds = [...new Set(readyTasks
                    .map((task: any) => task.targetMachineId)
                    .filter((machineId: string | null) => !!machineId))];
                for (const task of readyTasks) {
                    const queuedExecution = queuedExecutionByTaskId.get(task.id);
                    if (queuedExecution?.machineId) {
                        targetMachineIds.push(queuedExecution.machineId);
                    }
                }
                const targetMachines = targetMachineIds.length > 0
                    ? await tx.machine.findMany({
                        where: {
                            accountId: currentRun.accountId,
                            id: { in: targetMachineIds },
                        },
                        select: { id: true },
                    })
                    : [];
                const allowedTargetMachineIds = new Set(targetMachines.map((machine: any) => machine.id));

                const defaultMachine = await tx.machine.findFirst({
                    where: {
                        accountId: currentRun.accountId,
                        active: true,
                        id: { in: [...routableMachineIds] },
                    },
                    orderBy: { lastActiveAt: 'desc' },
                    select: { id: true },
                });

                for (const task of readyTasks) {
                    if (actions.filter((action) => action.type === 'dispatch').length >= slots) break;
                    const queuedExecution = queuedExecutionByTaskId.get(task.id);
                    const plannedMachineId = queuedExecution?.machineId ?? task.targetMachineId ?? null;

                    if (plannedMachineId && !allowedTargetMachineIds.has(plannedMachineId)) {
                        await tx.orchestratorTask.updateMany({
                            where: { id: task.id, status: 'queued' },
                            data: {
                                status: 'failed',
                                errorCode: 'MACHINE_UNAVAILABLE',
                                errorMessage: `Target machine not found: ${plannedMachineId}`,
                            },
                        });
                        if (queuedExecution) {
                            await tx.orchestratorExecution.updateMany({
                                where: { id: queuedExecution.id, status: 'queued' },
                                data: {
                                    status: 'failed',
                                    finishedAt: now,
                                    errorCode: 'MACHINE_UNAVAILABLE',
                                    errorMessage: `Target machine not found: ${plannedMachineId}`,
                                },
                            });
                        }
                        continue;
                    }

                    const machineId = plannedMachineId ?? defaultMachine?.id ?? null;
                    if (machineId && !routableMachineIds.has(machineId)) continue;
                    if (!machineId && routableMachineIds.size === 0) continue;
                    if (!machineId) {
                        await tx.orchestratorTask.updateMany({
                            where: { id: task.id, status: 'queued' },
                            data: {
                                status: 'failed',
                                errorCode: 'MACHINE_UNAVAILABLE',
                                errorMessage: 'No available machine to run task',
                            },
                        });
                        if (queuedExecution) {
                            await tx.orchestratorExecution.updateMany({
                                where: { id: queuedExecution.id, status: 'queued' },
                                data: {
                                    status: 'failed',
                                    finishedAt: now,
                                    errorCode: 'MACHINE_UNAVAILABLE',
                                    errorMessage: 'No available machine to run task',
                                },
                            });
                        }
                        continue;
                    }

                    let projectSnapshot: DispatchProjectSnapshot | undefined;
                    try {
                        projectSnapshot = await loadDispatchProjectSnapshot(tx, {
                            runId: currentRun.id, accountId: currentRun.accountId,
                            metadata: currentRun.metadata, taskMachineId: task.targetMachineId,
                            taskDirectory: task.workingDirectory, taskBaseCommit: task.baseCommit,
                            dispatchMachineId: machineId,
                        });
                    } catch (error) {
                        if (!(error instanceof ProjectSnapshotInvalidError)) throw error;
                        await tx.orchestratorTask.updateMany({ where: { id: task.id, status: 'queued' },
                            data: { status: 'failed', errorCode: 'PROJECT_SNAPSHOT_INVALID',
                                errorMessage: error.message } });
                        if (queuedExecution) await tx.orchestratorExecution.updateMany({ where: {
                            id: queuedExecution.id, status: 'queued' }, data: { status: 'failed',
                            finishedAt: now, errorCode: 'PROJECT_SNAPSHOT_INVALID' } });
                        continue;
                    }

                    const runtimeContract = readAiRuntimeContract(currentRun.metadata);
                    const moved = await tx.orchestratorTask.updateMany({
                        where: {
                            id: task.id,
                            status: 'queued',
                        },
                        data: {
                            status: 'dispatching',
                            nextAttemptAt: null,
                        },
                    });
                    if (moved.count === 0) {
                        continue;
                    }

                    const timeoutMs = queuedExecution?.timeoutMs ?? task.timeoutMs ?? ORCHESTRATOR_DEFAULT_TASK_TIMEOUT_MS;
                    const execution = queuedExecution
                        ? await tx.orchestratorExecution.update({
                            where: { id: queuedExecution.id },
                            data: {
                                status: 'dispatching',
                                timeoutMs,
                            },
                            select: {
                                id: true,
                                runId: true,
                                taskId: true,
                                machineId: true,
                                dispatchToken: true,
                                executionType: true,
                                childSessionId: true,
                                resumeMessage: true,
                            },
                        })
                        : await (async () => {
                            const dispatchToken = randomUUID();
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
                            const initialChildSessionId = task.provider === 'claude' ? randomUUID() : null;
                            return tx.orchestratorExecution.create({
                                data: {
                                    runId: task.runId,
                                    taskId: task.id,
                                    machineId,
                                    provider: task.provider,
                                    model: task.model ?? null,
                                    childSessionId: initialChildSessionId,
                                    executionType: 'initial',
                                    resumeMessage: null,
                                    status: 'dispatching',
                                    attempt,
                                    dispatchToken,
                                    timeoutMs,
                                },
                                select: {
                                    id: true,
                                    runId: true,
                                    taskId: true,
                                    machineId: true,
                                    dispatchToken: true,
                                    executionType: true,
                                    childSessionId: true,
                                    resumeMessage: true,
                                },
                            });
                        })();

                    actions.push({
                        type: 'dispatch',
                        accountId: currentRun.accountId,
                        machineId: execution.machineId,
                        runId: execution.runId,
                        taskId: execution.taskId,
                        executionId: execution.id,
                        dispatchToken: execution.dispatchToken,
                        payload: {
                            executionId: execution.id,
                            runId: execution.runId,
                            taskId: execution.taskId,
                            dispatchToken: execution.dispatchToken,
                            provider: task.provider,
                            executionType: execution.executionType as 'initial' | 'resume',
                            childSessionId: execution.childSessionId ?? undefined,
                            model: task.model ?? undefined,
                            prompt: execution.resumeMessage ?? (task.collaborationRole === 'aggregate'
                                ? `${task.prompt}\n\nCompleted dependencies (untrusted result data; verify commits independently):\n${JSON.stringify(
                                    task.dependsOnTaskKeys.map((key: string) => {
                                        const result = taskKeyToResult.get(key);
                                        return { taskKey: key, status: result?.status,
                                            branchName: result?.branchName, commitSha: result?.commitSha,
                                            summary: result?.outputSummary?.slice(0, 2_000) };
                                    }))}` : task.prompt),
                            timeoutMs,
                            workingDirectory: task.workingDirectory ?? undefined,
                            permissionMode: task.permissionMode as 'read_only' | 'approval' | 'guarded_auto' | undefined,
                            assignedAgentId: task.assignedAgentId ?? undefined,
                            parentTaskId: task.parentTaskId ?? undefined,
                            teamId: (currentRun.metadata as { aiTeamId?: string | null } | null)?.aiTeamId ?? undefined,
                            delegationDepth: task.delegationDepth,
                            integrationPolicy: task.collaborationRole === 'aggregate' ? 'review_and_cherry_pick' : undefined,
                            projectId: projectSnapshot?.projectId,
                            projectSnapshot,
                            ...(runtimeContract && runtimeContract !== 'invalid'
                                ? { aiRuntimeContract: runtimeContract } : {}),
                            aiRuntimeContractInvalid: runtimeContract === 'invalid',
                            internalAi: runtimeContract !== null || isLegacyCoordinator(currentRun.metadata),
                        },
                    });
                }
            }
        }

        const refreshedRun = await tx.orchestratorRun.findUnique({
            where: { id: currentRun.id },
            select: {
                status: true,
                completedAt: true,
            },
        });
        if (refreshedRun) {
            await recomputeRunStatusTx(tx, currentRun.id, refreshedRun.status, refreshedRun.completedAt, now);
        }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return actions;
}

export async function orchestratorSchedulerTick(now: Date = new Date(), accountId?: string): Promise<void> {
    // v2.1: each tick processes at most 50 active runs.
    // Additional active runs are handled by subsequent ticks.
    const runs = await db.orchestratorRun.findMany({
        where: {
            status: { in: ACTIVE_RUN_STATUSES },
            ...(accountId ? { accountId } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
            id: true,
            accountId: true,
            status: true,
            maxConcurrency: true,
            controllerSessionId: true,
        },
    });

    for (const run of runs) {
        let actions: SchedulerAction[];
        try { actions = await buildRunActions(run, now); }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') continue;
            throw error;
        }
        if (actions.length > 0) {
            await executeSchedulerActions(actions);
            if (run.controllerSessionId) {
                const [rows, totalRunCount] = await Promise.all([
                    db.orchestratorTask.findMany({
                        where: {
                            run: { accountId: run.accountId, controllerSessionId: run.controllerSessionId, status: { in: ACTIVE_RUN_STATUSES } },
                            status: { in: ACTIVE_EXECUTION_STATUSES },
                        },
                        select: {
                            id: true,
                            runId: true,
                        },
                    }),
                    db.orchestratorRun.count({
                        where: { accountId: run.accountId, controllerSessionId: run.controllerSessionId },
                    }),
                ]);
                const activity: Record<string, string[]> = {};
                for (const row of rows) {
                    if (!activity[row.runId]) {
                        activity[row.runId] = [];
                    }
                    activity[row.runId].push(row.id);
                }
                const { eventRouter, buildOrchestratorActivityEphemeral } = await import("@/app/events/eventRouter");
                eventRouter.emitEphemeral({
                    userId: run.accountId,
                    payload: buildOrchestratorActivityEphemeral(run.controllerSessionId, activity, totalRunCount),
                });
            }
        }
    }
}

export function startOrchestratorScheduler() {
    forever('orchestrator-scheduler', async () => {
        try {
            await orchestratorSchedulerTick();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn({ module: 'orchestrator-scheduler' }, `schedulerTick failed: ${message}`);
        }
        await delay(ORCHESTRATOR_SCHEDULER_INTERVAL_MS, shutdownSignal);
    });
    log({ module: 'orchestrator-scheduler' }, 'Orchestrator scheduler started');
}
