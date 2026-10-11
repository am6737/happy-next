import { afterTx, inTx } from '@/storage/inTx';
import { TeammateTaskDelegateRequestSchema, type TeammateTaskDelegateRequest } from 'happy-wire';
import { getUserOctokit } from '@/app/github/githubApi';
import { TeammateError } from './teammateError';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { toTeammateTaskDto } from './teammateQueries';
import { teammateTaskUpdated } from './teammateTaskUpdated';

/** Delegate one open issue per account atomically; repeats reuse it and acknowledgement is best effort. */
export async function teammateTaskDelegate(accountId: string, input: TeammateTaskDelegateRequest, createdByTeammateId?: string, createdByThreadId?: string) {
    const req = TeammateTaskDelegateRequestSchema.parse(input);
    let reaction: Promise<void> | undefined;
    const task = await inTx(async tx => {
        const teammate = await tx.teammate.findFirst({ where: { id: req.teammateId, accountId } });
        if (!teammate) throw new TeammateError('not_found');
        if (teammate.status === 'archived') throw new TeammateError('archived');
        const open = await tx.teammateTask.findFirst({ where: { accountId, source: req.source, resourceId: req.resourceId, status: { notIn: ['done', 'cancelled'] } } });
        if (open) {
            if (open.teammateId !== req.teammateId) throw new TeammateError('already_delegated');
            return toTeammateTaskDto(open);
        }
        const row = await tx.teammateTask.create({ data: { accountId, ...req, status: 'todo', createdByTeammateId, createdByThreadId } });
        const thread = await teammateThreadEnsure(teammate.id, 'task', { taskId: row.id }, tx);
        await teammateRunEnqueue({ teammateId: teammate.id, threadId: thread.id, trigger: 'task-assigned', event: { type: 'task-assigned', at: Date.now(), data: { taskId: row.id } } }, tx);
        const task = toTeammateTaskDto(row);
        await teammateTaskUpdated(tx, accountId, task);
        afterTx(tx, () => {
            reaction = (async () => {
                try {
                    const [owner, repoAndNumber] = req.resourceId.split('/');
                    const [repo, number] = repoAndNumber.split('#');
                    const octokit = await getUserOctokit(accountId);
                    await octokit.rest.reactions.createForIssue({ owner, repo, issue_number: Number(number), content: 'eyes' });
                } catch { /* acknowledgement is best effort */ }
            })();
        });
        return task;
    });
    await reaction;
    return task;
}
