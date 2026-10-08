import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    state,
    invokeUserRpcMock,
    methodsMock,
    provisionMock,
    dbMock,
    resetState,
} = vi.hoisted(() => {
    const state = {
        runStatus: 'running',
        taskStatus: 'dispatching',
        executionStatus: 'dispatching',
    };

    const resetState = () => {
        state.runStatus = 'running';
        state.taskStatus = 'dispatching';
        state.executionStatus = 'dispatching';
    };

    const invokeUserRpcMock = vi.fn(async (_account: string, _method: string,
        _params: any, _timeout?: number): Promise<any> => ({}));
    const methodsMock = vi.fn((): string[] => []);
    const provisionMock = vi.fn(async () => ({ token: 'a'.repeat(64), protocolVersion: 1,
        allowedOps: ['finish'], expiresAt: '2026-10-07T16:00:00.000Z' }));

    const dbMock = {
        aiWorkItem: { findFirst: vi.fn(async () => null) },
        orchestratorRun: {
            findMany: vi.fn(async () => []),
        },
        $transaction: vi.fn(async (fn: any) => {
            const tx = {
                orchestratorExecution: {
                    findUnique: vi.fn(async () => ({
                        id: 'exec_1',
                        status: state.executionStatus,
                        runId: 'run_1',
                        taskId: 'task_1',
                        attempt: 1,
                    })),
                    update: vi.fn(async (args: any) => {
                        state.executionStatus = args.data.status;
                        return { id: 'exec_1' };
                    }),
                },
                orchestratorTask: {
                    findUnique: vi.fn(async () => ({
                        retryMaxAttempts: 1,
                        retryBackoffMs: 0,
                    })),
                    updateMany: vi.fn(async (args: any) => {
                        if (state.taskStatus !== args.where.status) {
                            return { count: 0 };
                        }
                        state.taskStatus = args.data.status;
                        return { count: 1 };
                    }),
                    groupBy: vi.fn(async () => [
                        { status: state.taskStatus, _count: { _all: 1 } },
                    ]),
                },
                orchestratorRun: {
                    findUnique: vi.fn(async () => ({
                        id: 'run_1',
                        status: state.runStatus,
                    })),
                    update: vi.fn(async (args: any) => {
                        state.runStatus = args.data.status;
                        return { id: 'run_1', status: state.runStatus };
                    }),
                },
            };
            return fn(tx);
        }),
    };

    return {
        state,
        invokeUserRpcMock,
        methodsMock,
        provisionMock,
        dbMock,
        resetState,
    };
});

vi.mock('@/storage/db', () => ({
    db: dbMock,
}));

vi.mock('@/app/api/socket/rpcRegistry', () => ({
    invokeUserRpc: invokeUserRpcMock,
    listConnectedUserRpcMethods: methodsMock,
}));
vi.mock('@/app/ai/workspaceAuth', () => ({ provisionDispatchCapability: provisionMock }));

import { executeSchedulerActions, failTimedOutRunningExecutionsTx,
    ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS, type SchedulerAction } from './scheduler';
import { orchestratorSchedulerTick } from './scheduler';

describe('orchestrator scheduler actions', () => {
    beforeEach(() => {
        resetState();
        invokeUserRpcMock.mockClear();
        invokeUserRpcMock.mockImplementation(async () => ({}));
        methodsMock.mockReturnValue([]);
        provisionMock.mockClear();
        dbMock.aiWorkItem.findFirst.mockResolvedValue(null);
        dbMock.$transaction.mockClear();
        dbMock.orchestratorRun.findMany.mockClear();
    });

    it('dispatches action via invokeUserRpc', async () => {
        const actions: SchedulerAction[] = [
            {
                type: 'dispatch',
                accountId: 'user_1',
                machineId: 'machine_1',
                executionId: 'exec_1',
                runId: 'run_1',
                taskId: 'task_1',
                dispatchToken: 'token_1',
                payload: {
                    executionId: 'exec_1',
                    runId: 'run_1',
                    taskId: 'task_1',
                    dispatchToken: 'token_1',
                    provider: 'codex',
                    executionType: 'initial',
                    prompt: 'hello',
                    timeoutMs: 1000,
                },
            },
        ];

        await executeSchedulerActions(actions);

        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user_1',
            'machine_1:orchestrator-dispatch',
            expect.objectContaining({ executionId: 'exec_1' }),
            expect.any(Number),
        );
        expect(dbMock.$transaction).not.toHaveBeenCalled();
    });

    it('fixes an advertised capability protocol before dispatch', async () => {
        methodsMock.mockReturnValue(['machine_1:orchestrator-features']);
        invokeUserRpcMock.mockImplementation(async (_account, method, params) => method.endsWith(':orchestrator-features')
            ? { nonce: params.nonce, machineId: 'machine_1', protocolVersion: 1,
                executionCapabilityVersion: 1 } : {});
        await executeSchedulerActions([{ type: 'dispatch', accountId: 'user_1', machineId: 'machine_1',
            executionId: 'exec_1', runId: 'run_1', taskId: 'task_1', dispatchToken: 'token_1',
            payload: { executionId: 'exec_1', runId: 'run_1', taskId: 'task_1',
                dispatchToken: 'token_1', provider: 'codex', executionType: 'initial',
                prompt: 'hello', timeoutMs: 1000 } }]);
        expect(provisionMock).toHaveBeenCalledOnce();
        expect(invokeUserRpcMock).toHaveBeenCalledWith('user_1',
            'machine_1:orchestrator-dispatch', expect.objectContaining({
                executionCapability: expect.objectContaining({ protocolVersion: 1 }),
            }), expect.any(Number));
    });

    it('does not dispatch a new AI work item to a legacy machine', async () => {
        dbMock.aiWorkItem.findFirst.mockResolvedValue({ id: 'work_1' } as never);
        await executeSchedulerActions([{ type: 'dispatch', accountId: 'user_1', machineId: 'machine_1',
            executionId: 'exec_1', runId: 'run_1', taskId: 'task_1', dispatchToken: 'token_1',
            payload: { executionId: 'exec_1', runId: 'run_1', taskId: 'task_1',
                dispatchToken: 'token_1', provider: 'codex', executionType: 'initial',
                prompt: 'hello', timeoutMs: 1000 } }]);
        expect(invokeUserRpcMock).not.toHaveBeenCalled();
        expect(provisionMock).not.toHaveBeenCalled();
        expect(state.executionStatus).toBe('failed');
    });

    it('marks task/execution failed when dispatch rpc fails', async () => {
        invokeUserRpcMock.mockRejectedValueOnce(new Error('RPC method not available'));

        const actions: SchedulerAction[] = [
            {
                type: 'dispatch',
                accountId: 'user_1',
                machineId: 'machine_1',
                executionId: 'exec_1',
                runId: 'run_1',
                taskId: 'task_1',
                dispatchToken: 'token_1',
                payload: {
                    executionId: 'exec_1',
                    runId: 'run_1',
                    taskId: 'task_1',
                    dispatchToken: 'token_1',
                    provider: 'claude',
                    executionType: 'initial',
                    prompt: 'hello',
                    timeoutMs: 1000,
                },
            },
        ];

        await executeSchedulerActions(actions);

        expect(state.executionStatus).toBe('failed');
        expect(state.taskStatus).toBe('failed');
        expect(state.runStatus).toBe('failed');
        expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('scheduler tick exits quietly when there are no active runs', async () => {
        dbMock.orchestratorRun.findMany.mockResolvedValueOnce([]);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));

        expect(dbMock.orchestratorRun.findMany).toHaveBeenCalledTimes(1);
        expect(invokeUserRpcMock).not.toHaveBeenCalled();
    });
});

describe('scheduler watchdog fallback', () => {
    it('waits for the daemon report at the deadline and fences an unreported execution without retry', async () => {
        const timeoutMs = 1_000;
        const startedAt = new Date('2026-10-08T00:00:00.000Z');
        let executionStatus = 'running';
        let taskStatus = 'running';
        const executionUpdate = vi.fn(async ({ where, data }: any) => {
            if (where.status !== executionStatus) return { count: 0 };
            executionStatus = data.status;
            return { count: 1 };
        });
        const taskUpdate = vi.fn(async ({ where, data }: any) => {
            if (where.status !== taskStatus) return { count: 0 };
            taskStatus = data.status;
            return { count: 1 };
        });
        const tx = { orchestratorExecution: {
            findMany: vi.fn(async () => executionStatus === 'running' ? [{
                id: 'exec_1', taskId: 'task_1', startedAt, createdAt: startedAt, timeoutMs,
            }] : []),
            updateMany: executionUpdate,
        }, orchestratorTask: { updateMany: taskUpdate } };
        const deadline = startedAt.getTime() + timeoutMs + ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS;

        await failTimedOutRunningExecutionsTx(tx, 'run_1', new Date(deadline - 1));
        expect(executionUpdate).not.toHaveBeenCalled();
        expect(taskStatus).toBe('running');

        await failTimedOutRunningExecutionsTx(tx, 'run_1', new Date(deadline));
        expect(executionStatus).toBe('timeout');
        expect(taskStatus).toBe('failed');
        expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'failed', nextAttemptAt: null,
                errorCode: 'TASK_TIMEOUT' }),
        }));
        await failTimedOutRunningExecutionsTx(tx, 'run_1', new Date(deadline + 1));
        expect(executionUpdate).toHaveBeenCalledTimes(1);
    });
});
