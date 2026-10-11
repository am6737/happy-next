import { inTx } from '@/storage/inTx';
import { TeammateTaskAgentUpdateRequestSchema, type TeammateTaskAgentUpdateRequest } from 'happy-wire';
import { teammateRunAuthorize } from './teammateRunAuthorize';
import { TeammateError } from './teammateError';
import { toTeammateTaskDto } from './teammateQueries';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { teammateTaskStopRpc } from './teammateTaskTerminate';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';
import { teammateTaskReviewRoute } from './teammateTaskReviewRoute';
import { teammateTaskIdleRunsDrop } from './teammateTaskIdleRunsDrop';

/** Authorize the task controller and update its lifecycle; inactive status changes are rejected. */
export async function teammateTaskAgentUpdate(accountId: string, input: TeammateTaskAgentUpdateRequest) {
    const req = TeammateTaskAgentUpdateRequestSchema.parse(input);
    return inTx(async tx => {
        const run = await teammateRunAuthorize(accountId, req.runId, req.dispatchToken, tx);
        if (run.thread.kind !== 'task' || !run.thread.taskId) throw new TeammateError('invalid_request');
        const task = await tx.teammateTask.findFirst({ where: { id: run.thread.taskId, accountId, teammateId: run.teammateId }, include: { teammate: true } });
        if (!task) throw new TeammateError('not_found');
        const verdictStatus = req.verdict === 'approved' ? 'done' : req.verdict === 'changes_requested' ? 'awaiting_input' : undefined;
        if (req.verdict !== undefined) {
            if (!task.parentTaskId) throw new TeammateError('invalid_request');
            if (req.status !== undefined && req.status !== verdictStatus) throw new TeammateError('invalid_request');
            if (task.status === verdictStatus) return toTeammateTaskDto(task);
            if (task.status === 'done' || task.status === 'awaiting_input') throw new TeammateError('invalid_request');
        }
        const requestedStatus = verdictStatus ?? req.status;
        if (requestedStatus && requestedStatus !== task.status && ['paused', 'cancelled', 'done'].includes(task.status)
            && !(task.status === 'done' && ['in_review', 'in_progress'].includes(requestedStatus))) throw new TeammateError('task_inactive');
        if (task.status === 'done' && requestedStatus && ['in_review', 'in_progress'].includes(requestedStatus) && task.resourceId) {
            const open = await tx.teammateTask.findFirst({ where: { accountId, source: task.source, resourceId: task.resourceId, id: { not: task.id }, status: { notIn: ['done', 'cancelled'] } } });
            if (open) throw new TeammateError('already_delegated');
        }
        const data = { ...(requestedStatus === undefined ? {} : { status: requestedStatus }), ...(req.summary === undefined ? {} : { summary: req.summary }), ...(req.prUrl === undefined ? {} : { prUrl: req.prUrl }) };
        if (Object.entries(data).every(([key, value]) => task[key as keyof typeof task] === value)) return toTeammateTaskDto(task);
        const row = await tx.teammateTask.update({ where: { id: task.id }, data });
        const review = await teammateTaskReviewRoute(tx, task, row, req);
        if (requestedStatus !== undefined && !review.routed) await teammateTaskHandoffNotify(tx, task, row, 'agent');
        await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(row));
        if (requestedStatus === 'done' && task.status !== 'done') teammateTaskStopRpc(tx, task, 'done');
        if (requestedStatus && ['in_review', 'done'].includes(requestedStatus) && task.status !== requestedStatus) await teammateTaskIdleRunsDrop(tx, task.id);
        return toTeammateTaskDto(row);
    });
}
