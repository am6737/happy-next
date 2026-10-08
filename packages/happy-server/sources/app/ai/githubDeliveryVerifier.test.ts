import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), findTask: vi.fn(), verify: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: {
    aiWorkItem: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    orchestratorTask: { findUnique: mocks.findTask },
} }));
vi.mock('@/app/api/routes/orchestratorRoutes', () => ({ verifyGithubDeliveryMetadata: mocks.verify }));

import { githubDeliveryVerificationTick } from './githubDeliveryVerifier';

const work = { id: 'work', accountId: 'account', orchestratorTaskId: 'task', sourceType: 'github',
    sourceResourceId: 'acme/project#42', pullRequestUrl: 'https://github.com/acme/project/pull/7',
    deliveryVerificationAttempts: 0, orchestratorRun: { metadata: { githubRepositoryId: '123' } } };

describe('durable delivery verification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findMany.mockResolvedValue([work]);
        mocks.findTask.mockResolvedValue({ status: 'completed', finalResponse: 'Done', branchName: 'agent/task',
            commitSha: 'a'.repeat(40), pullRequestUrl: work.pullRequestUrl });
        mocks.updateMany.mockResolvedValue({ count: 1 });
    });

    it('keeps an unverified exit-zero delivery blocked and schedules retry', async () => {
        mocks.verify.mockResolvedValue(null);
        await githubDeliveryVerificationTick(new Date('2026-10-07T00:00:00Z'));
        expect(mocks.verify).toHaveBeenCalledWith('account', expect.stringContaining('Created GitHub issue:'),
            'agent/task', 'a'.repeat(40), 123n, 'acme/project#42');
        expect(mocks.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'work',
            deliveryVerificationStatus: 'pending', deliveryVerificationAttempts: 0 }),
            data: expect.objectContaining({ deliveryVerificationStatus: 'pending',
                deliveryVerificationAttempts: 1, requiresDecision: true }) });
    });

    it('records verified identity and releases manual review when GitHub checks pass', async () => {
        mocks.verify.mockResolvedValue({ issue: { resourceId: 'acme/project#42', label: 'GitHub acme/project#42' },
            pullRequest: { url: work.pullRequestUrl, number: 7 }, state: 'open', mergedAt: null });
        await githubDeliveryVerificationTick();
        expect(mocks.updateMany).toHaveBeenCalledWith({ where: expect.any(Object), data: expect.objectContaining({
            deliveryVerificationStatus: 'verified', pullRequestNumber: 7, deliveryVerifiedAt: expect.any(Date),
        }) });
        expect(mocks.updateMany.mock.calls[0][0].where.AND).toEqual([
            { OR: [{ pullRequestNumber: null }, { pullRequestNumber: 7 }] },
            { OR: [{ pullRequestState: null }, { pullRequestState: { in: ['open', 'closed'] } }] },
        ]);
    });
});
