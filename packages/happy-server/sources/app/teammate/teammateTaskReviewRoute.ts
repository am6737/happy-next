import type { TeammateTask as TeammateTaskRow } from '@prisma/client';
import { TEAMMATE_REVIEW_MAX_ROUNDS, type TeammateTaskAgentUpdateRequest } from 'happy-wire';
import type { Tx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';
import { teammateTaskUpdated } from './teammateTaskUpdated';
import { teammateTaskWake } from './teammateTaskWake';
import { teammateRunEnqueue } from './teammateRunEnqueue';
import { teammateThreadEnsure } from './teammateThreadEnsure';
import { toTeammateTaskDto } from './teammateQueries';

type ReviewResult = { routed: boolean };

function parsePullRequest(url: string | null | undefined): { owner: string; repo: string; number: number; resourceId: string } | null {
    if (!url) return null;
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(url);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]), resourceId: `${match[1]}/${match[2]}#${match[3]}` };
}

/** Route implementation handoffs to a designated reviewer and apply reviewer verdicts atomically. No network calls occur here. */
export async function teammateTaskReviewRoute(
    tx: Tx,
    before: TeammateTaskRow,
    after: TeammateTaskRow,
    req: TeammateTaskAgentUpdateRequest,
): Promise<ReviewResult> {
    if (req.verdict !== undefined) {
        if (!after.parentTaskId) throw new TeammateError('invalid_request');
        const expected = req.verdict === 'approved' ? 'done' : 'awaiting_input';
        if (after.status !== expected) {
            throw new TeammateError('invalid_request');
        }
        const implementation = await tx.teammateTask.findFirst({ where: { id: after.parentTaskId, accountId: after.accountId } });
        if (!implementation) throw new TeammateError('not_found');
        const round = after.reviewRound || 1;

        if (req.verdict === 'approved') {
            await teammateTaskHandoffNotify(tx, before, after, 'agent');
            return { routed: true };
        }

        if (round < TEAMMATE_REVIEW_MAX_ROUNDS) {
            const implementationAfter = implementation.status === 'in_progress'
                ? implementation
                : await tx.teammateTask.update({ where: { id: implementation.id }, data: { status: 'in_progress' } });
            await teammateTaskWake(implementation.id, {
                type: 'review-feedback',
                at: Date.now(),
                data: {
                    taskId: implementation.id,
                    reviewTaskId: after.id,
                    round,
                    summary: after.summary,
                    prUrl: after.prUrl,
                    reviewerHandle: (await tx.teammate.findUnique({ where: { id: after.teammateId }, select: { handle: true } }))?.handle ?? null,
                },
            }, { tx, trigger: 'review-feedback' });
            await teammateTaskUpdated(tx, implementation.accountId, toTeammateTaskDto(implementationAfter));
            return { routed: true };
        }

        const implementationAfter = await tx.teammateTask.update({
            where: { id: implementation.id },
            data: { status: 'awaiting_input', summary: `Review round limit reached: ${after.summary ?? ''}`.trim() },
        });
        await teammateTaskHandoffNotify(tx, before, after, 'agent');
        await teammateTaskUpdated(tx, implementation.accountId, toTeammateTaskDto(implementationAfter));
        return { routed: true };
    }

    if (after.parentTaskId || before.status === after.status || after.status !== 'in_review' || !after.reviewerTeammateId) return { routed: false };
    const pr = parsePullRequest(req.prUrl ?? after.prUrl);
    if (!pr || after.resourceId?.toLowerCase() === pr.resourceId.toLowerCase()) return { routed: false };

    const reviewer = await tx.teammate.findFirst({ where: { id: after.reviewerTeammateId, accountId: after.accountId, status: 'active' } });
    if (!reviewer) return { routed: false };
    const existingReview = await tx.teammateTask.findFirst({ where: { accountId: after.accountId, parentTaskId: after.id } });
    const conflictingOpen = await tx.teammateTask.findFirst({
        where: {
            accountId: after.accountId,
            source: 'github-issue',
            resourceId: pr.resourceId,
            ...(existingReview ? { id: { not: existingReview.id } } : {}),
            status: { in: ['todo', 'in_progress', 'awaiting_input', 'in_review'] },
        },
    });
    if (conflictingOpen && conflictingOpen.teammateId !== reviewer.id) return { routed: false };

    const event = (taskId: string, round: number) => ({
        type: 'task-assigned' as const,
        at: Date.now(),
        // issue and builderSummary come from the row; the dispatcher adds GitHub context outside the transaction.
        data: { taskId, review: true, round, parentTaskId: after.id, prUrl: prUrl(after, req), issue: after.resourceId, builderSummary: req.summary ?? after.summary },
    });
    if (!existingReview) {
        const review = await tx.teammateTask.create({
            data: {
                accountId: after.accountId,
                teammateId: reviewer.id,
                source: 'github-issue',
                resourceId: pr.resourceId,
                title: `Review: ${after.title}`,
                url: prUrl(after, req),
                prUrl: prUrl(after, req),
                status: 'todo',
                parentTaskId: after.id,
                reviewRound: 1,
                createdByTeammateId: after.createdByTeammateId,
                createdByThreadId: after.createdByThreadId,
            },
        });
        const thread = await teammateThreadEnsure(reviewer.id, 'task', { taskId: review.id }, tx);
        await teammateRunEnqueue({ teammateId: reviewer.id, threadId: thread.id, trigger: 'task-assigned', event: event(review.id, 1) }, tx);
        await teammateTaskUpdated(tx, after.accountId, toTeammateTaskDto(review));
        return { routed: true };
    }

    if (existingReview.status === 'todo' || existingReview.status === 'in_progress' || existingReview.status === 'in_review') return { routed: true };
    const nextRound = (existingReview.reviewRound || 0) + 1;
    if (nextRound > TEAMMATE_REVIEW_MAX_ROUNDS) return { routed: false };
    const reopened = await tx.teammateTask.update({ where: { id: existingReview.id }, data: { status: 'todo', reviewRound: nextRound, summary: null, prUrl: prUrl(after, req), url: prUrl(after, req) } });
    await teammateTaskWake(reopened.id, event(reopened.id, nextRound), { tx });
    await teammateTaskUpdated(tx, after.accountId, toTeammateTaskDto(reopened));
    return { routed: true };
}

function prUrl(task: TeammateTaskRow, req: TeammateTaskAgentUpdateRequest): string {
    return req.prUrl ?? task.prUrl!;
}
