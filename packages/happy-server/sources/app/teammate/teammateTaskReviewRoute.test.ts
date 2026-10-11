import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handoff, updated, wake, enqueue, ensure } = vi.hoisted(() => ({
    handoff: vi.fn(), updated: vi.fn(), wake: vi.fn(), enqueue: vi.fn(), ensure: vi.fn(),
}));
vi.mock('./teammateTaskHandoffNotify', () => ({ teammateTaskHandoffNotify: handoff }));
vi.mock('./teammateTaskUpdated', () => ({ teammateTaskUpdated: updated }));
vi.mock('./teammateTaskWake', () => ({ teammateTaskWake: wake }));
vi.mock('./teammateRunEnqueue', () => ({ teammateRunEnqueue: enqueue }));
vi.mock('./teammateThreadEnsure', () => ({ teammateThreadEnsure: ensure }));
vi.mock('./teammateQueries', () => ({ toTeammateTaskDto: (row: unknown) => row }));

import { teammateTaskReviewRoute } from './teammateTaskReviewRoute';

const base = {
    id: 'impl', accountId: 'account', teammateId: 'builder', createdByTeammateId: 'lead', createdByThreadId: 'lead-thread',
    source: 'github-issue', resourceId: 'owner/repo#7', title: 'Fix race', url: 'https://github.com/owner/repo/issues/7',
    status: 'in_progress', summary: null, prUrl: null, reviewerTeammateId: 'reviewer', parentTaskId: null, reviewRound: 0,
    createdIssue: false, createdAt: new Date(), updatedAt: new Date(),
};
const req = { runId: 'run', dispatchToken: 'token', status: 'in_review' as const, summary: 'Ready', prUrl: 'https://github.com/owner/repo/pull/9' };

function txFor(review: any = null) {
    return {
        teammate: { findFirst: vi.fn().mockResolvedValue({ id: 'reviewer', accountId: 'account', status: 'active' }), findUnique: vi.fn().mockResolvedValue({ handle: 'reviewer' }) },
        teammateTask: {
            findFirst: vi.fn().mockImplementation(({ where }: any) => where.parentTaskId ? review : where.id === 'impl' ? base : null),
            create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: 'review', createdAt: new Date(), updatedAt: new Date() })),
            update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...base, id: where.id, ...data, createdAt: new Date(), updatedAt: new Date() })),
        },
    } as any;
}

beforeEach(() => {
    vi.clearAllMocks();
    ensure.mockResolvedValue({ id: 'review-thread' });
});

describe('teammateTaskReviewRoute', () => {
    it('creates and assigns a review task with round metadata', async () => {
        const tx = txFor();
        const result = await teammateTaskReviewRoute(tx, base as any, { ...base, status: 'in_review', prUrl: req.prUrl } as any, req as any);
        expect(result).toEqual({ routed: true });
        expect(tx.teammateTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ teammateId: 'reviewer', resourceId: 'owner/repo#9', parentTaskId: 'impl', reviewRound: 1, createdByTeammateId: 'lead' }) });
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'task-assigned', event: expect.objectContaining({ data: expect.objectContaining({ review: true, round: 1, parentTaskId: 'impl', prUrl: req.prUrl }) }) }), tx);
        expect(updated).toHaveBeenCalled();
    });

    it('sends feedback to the builder without waking the lead', async () => {
        const review = { ...base, id: 'review', teammateId: 'reviewer', parentTaskId: 'impl', reviewRound: 1, status: 'in_review', prUrl: req.prUrl, summary: null };
        const tx = txFor(review);
        const after = { ...review, status: 'awaiting_input', summary: 'Please add a test' };
        await teammateTaskReviewRoute(tx, review as any, after as any, { ...req, verdict: 'changes_requested' } as any);
        expect(wake).toHaveBeenCalledWith('impl', expect.objectContaining({ type: 'review-feedback', data: expect.objectContaining({ round: 1, summary: 'Please add a test' }) }), expect.objectContaining({ trigger: 'review-feedback' }));
        expect(handoff).not.toHaveBeenCalled();
    });

    it('notifies the lead on approval and is separate from implementation status', async () => {
        const review = { ...base, id: 'review', teammateId: 'reviewer', parentTaskId: 'impl', reviewRound: 1, status: 'in_review', prUrl: req.prUrl, summary: 'Approved' };
        const tx = txFor(review);
        await teammateTaskReviewRoute(tx, review as any, { ...review, status: 'done' } as any, { ...req, status: 'done', verdict: 'approved' } as any);
        expect(handoff).toHaveBeenCalledWith(tx, review, expect.objectContaining({ status: 'done' }), 'agent');
    });

    it('reopens the same review task for the next round', async () => {
        const review = { ...base, id: 'review', teammateId: 'reviewer', parentTaskId: 'impl', reviewRound: 1, status: 'awaiting_input', prUrl: req.prUrl, summary: 'Fix it' };
        const tx = txFor(review);
        const result = await teammateTaskReviewRoute(tx, base as any, { ...base, status: 'in_review', prUrl: req.prUrl } as any, req as any);
        expect(result).toEqual({ routed: true });
        expect(tx.teammateTask.update).toHaveBeenCalledWith({ where: { id: 'review' }, data: expect.objectContaining({ status: 'todo', reviewRound: 2 }) });
        expect(wake).toHaveBeenCalledWith('review', expect.objectContaining({ type: 'task-assigned' }), { tx });
    });

    it('escalates after the third requested-change round', async () => {
        const review = { ...base, id: 'review', teammateId: 'reviewer', parentTaskId: 'impl', reviewRound: 3, status: 'in_review', prUrl: req.prUrl, summary: null };
        const tx = txFor(review);
        await teammateTaskReviewRoute(tx, review as any, { ...review, status: 'awaiting_input', summary: 'Still failing' } as any, { ...req, verdict: 'changes_requested' } as any);
        expect(tx.teammateTask.update).toHaveBeenCalledWith({ where: { id: 'impl' }, data: { status: 'awaiting_input', summary: 'Review round limit reached: Still failing' } });
        expect(handoff).toHaveBeenCalled();
        expect(wake).not.toHaveBeenCalled();
    });
});
