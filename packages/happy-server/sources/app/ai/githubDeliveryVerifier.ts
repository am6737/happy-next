import { db } from '@/storage/db';
import { verifyGithubDeliveryMetadata } from '@/app/api/routes/orchestratorRoutes';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { warn } from '@/utils/log';

const INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 12;

export async function githubDeliveryVerificationTick(now = new Date(), accountId?: string): Promise<void> {
    const works = await db.aiWorkItem.findMany({ where: {
        ...(accountId ? { accountId } : {}),
        deliveryVerificationStatus: 'pending', deliveryVerificationNextAt: { lte: now },
    }, orderBy: { deliveryVerificationNextAt: 'asc' }, take: 10,
        include: { orchestratorRun: { select: { metadata: true } } },
    });
    await Promise.all(works.map(async (work) => {
        const task = await db.orchestratorTask.findUnique({ where: { id: work.orchestratorTaskId },
            select: { status: true, finalResponse: true,
                branchName: true, commitSha: true, pullRequestUrl: true } });
        if (!task || task.status !== 'completed') return;
        const metadata = work.orchestratorRun.metadata as { githubRepositoryId?: string | null } | null;
        const repositoryId = metadata?.githubRepositoryId;
        let trustedPrefix = '';
        if (work.sourceType === 'github') {
            const source = work.sourceResourceId.match(/^([^/#]+)\/([^/#]+)#([1-9]\d*)$/);
            if (source) trustedPrefix += `Created GitHub issue: https://github.com/${source[1]}/${source[2]}/issues/${source[3]}\n`;
        }
        const prUrl = work.pullRequestUrl ?? task.pullRequestUrl;
        if (prUrl) trustedPrefix += `Created pull request: ${prUrl}\n`;
        const report = trustedPrefix + (task.finalResponse ?? '');
        let verified: Awaited<ReturnType<typeof verifyGithubDeliveryMetadata>> = null;
        let errorCode = 'unverified';
        if (repositoryId && /^\d+$/.test(repositoryId)) {
            try {
                verified = await verifyGithubDeliveryMetadata(work.accountId, report,
                    task.branchName, task.commitSha, BigInt(repositoryId),
                    work.sourceType === 'github' ? work.sourceResourceId : undefined);
            } catch { errorCode = 'api_unavailable'; }
        } else errorCode = 'repository_unbound';
        const where = { id: work.id, accountId: work.accountId,
            deliveryVerificationStatus: 'pending', deliveryVerificationAttempts: work.deliveryVerificationAttempts,
            deliveryVerificationNextAt: { lte: now } };
        if (verified) {
            await db.aiWorkItem.updateMany({ where: { ...where,
                AND: [
                    { OR: [{ pullRequestNumber: null }, { pullRequestNumber: verified.pullRequest.number }] },
                    { OR: [{ pullRequestState: null }, { pullRequestState: { in: ['open', 'closed'] } }] },
                ],
            }, data: {
                sourceType: 'github', sourceLabel: verified.issue.label, sourceResourceId: verified.issue.resourceId,
                pullRequestUrl: verified.pullRequest.url, pullRequestNumber: verified.pullRequest.number,
                pullRequestState: verified.state, pullRequestMergedAt: verified.mergedAt,
                deliveryVerificationStatus: 'verified', deliveryVerifiedAt: new Date(),
                deliveryVerificationNextAt: null, deliveryVerificationErrorCode: null,
                requiresDecision: true,
            } });
            return;
        }
        const attempts = work.deliveryVerificationAttempts + 1;
        const blocked = attempts >= MAX_ATTEMPTS;
        await db.aiWorkItem.updateMany({ where, data: {
            deliveryVerificationAttempts: attempts,
            deliveryVerificationStatus: blocked ? 'blocked' : 'pending',
            deliveryVerificationNextAt: blocked ? null : new Date(now.getTime() + Math.min(30_000 * 2 ** attempts, 600_000)),
            deliveryVerificationErrorCode: errorCode,
            requiresDecision: true,
        } });
    }));
}

export function startGithubDeliveryVerifier(): void {
    forever('github-delivery-verifier', async () => {
        try { await githubDeliveryVerificationTick(); }
        catch { warn({ module: 'github-delivery-verifier' }, 'Delivery verification tick failed'); }
        await delay(INTERVAL_MS, shutdownSignal);
    });
}
