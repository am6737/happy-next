import { db } from "@/storage/db";
import { warn } from "@/utils/log";
import { failRunningExecutionTx, recomputeRunStatusTx } from "./scheduler";
import { emitOrchestratorRunActivity } from "./sessions";
import { isRunTerminal } from "./state";
import { notifyOrchestratorRunTerminal } from "./terminal";

/**
 * Fail the executions the server still has running on a machine that its daemon has lost: the
 * daemon calls this each time it connects, with the executions it is running and when it started.
 * An execution it is not running that started before it did belonged to a daemon that has since
 * restarted, so its result will never come. One it is not running that started later has
 * finished, and its result is on its way, so it is left alone (as are dispatches not yet
 * started, which the scheduler fails once they go stale).
 *
 * Lost executions fail with `EXECUTION_LOST` and are retried as their task allows; runs this
 * finishes get their terminal callback. Both clocks compared are the daemon's: `startedAt` is
 * reported by the daemon that started the execution.
 *
 * Idempotent: an execution is failed only while it is still running.
 */
export async function orchestratorMachineReconcile(
    userId: string,
    machineId: string,
    liveExecutionIds: string[],
    daemonStartedAt: Date,
): Promise<void> {
    const now = new Date();
    const { touchedRunIds, finishedRunIds } = await db.$transaction(async (tx) => {
        const lostExecutions = await tx.orchestratorExecution.findMany({
            where: {
                machineId,
                status: 'running',
                startedAt: { lt: daemonStartedAt },
                id: { notIn: liveExecutionIds },
                run: { accountId: userId },
            },
            select: {
                id: true,
                runId: true,
                taskId: true,
                attempt: true,
                task: {
                    select: {
                        retryMaxAttempts: true,
                        retryBackoffMs: true,
                    },
                },
                run: {
                    select: {
                        status: true,
                        completedAt: true,
                    },
                },
            },
        });

        const runs = new Map<string, { status: string; completedAt: Date | null }>();
        for (const execution of lostExecutions) {
            await failRunningExecutionTx(tx, execution, execution.run.status, {
                status: 'failed',
                errorCode: 'EXECUTION_LOST',
                errorMessage: `The Happy daemon on machine ${machineId} restarted while this ran, so its result was lost`,
            }, now);
            runs.set(execution.runId, execution.run);
        }

        const finishedRunIds: string[] = [];
        for (const [runId, run] of runs) {
            const nextStatus = await recomputeRunStatusTx(tx, runId, run.status, run.completedAt, now);
            if (!isRunTerminal(run.status) && isRunTerminal(nextStatus)) {
                finishedRunIds.push(runId);
            }
        }
        return { touchedRunIds: [...runs.keys()], finishedRunIds };
    });

    for (const runId of touchedRunIds) {
        void emitOrchestratorRunActivity(userId, runId).catch(warn);
    }
    for (const runId of finishedRunIds) {
        await notifyOrchestratorRunTerminal(userId, runId).catch(warn);
    }
}
