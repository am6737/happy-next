import { randomUUID } from 'node:crypto';
import type { AiGithubIssueIntent } from '@prisma/client';
import { db } from '@/storage/db';
import { getUserOctokit } from '@/app/github/githubApi';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { warn } from '@/utils/log';

type IntentIdentity = Pick<AiGithubIssueIntent, 'accountId' | 'conversationId' | 'clientMessageId'>;
const RECHECK_INTERVAL_MS = 60_000;
const LEASE_MS = 45_000;

export async function findGithubIssueForIntent(intent: AiGithubIssueIntent): Promise<number | null> {
    const octokit = await getUserOctokit(intent.accountId);
    const signal = AbortSignal.timeout(15_000);
    const [repository, actor] = await Promise.all([
        octokit.rest.repos.get({ owner: intent.owner, repo: intent.repo, request: { signal } }),
        octokit.rest.users.getAuthenticated({ request: { signal } }),
    ]);
    if (BigInt(repository.data.id) !== intent.repositoryId || !repository.data.permissions?.push) {
        throw new Error('Repository authorization changed');
    }
    for (let page = 1; page <= 10; page++) {
        const { data: issues } = await octokit.rest.issues.listForRepo({
            owner: intent.owner, repo: intent.repo, state: 'all', per_page: 100, page, request: { signal },
        });
        const issue = issues.find((item: { pull_request?: unknown; body?: string | null; title: string; user?: { id: number } | null; number: number }) =>
            !item.pull_request && item.title === intent.title && item.body === intent.body
            && item.user?.id === actor.data.id);
        if (issue) return issue.number;
        if (issues.length < 100) break;
    }
    return null;
}

export async function verifyGithubIssueNumber(intent: AiGithubIssueIntent, issueNumber: number): Promise<boolean> {
    const octokit = await getUserOctokit(intent.accountId);
    const signal = AbortSignal.timeout(15_000);
    const [repository, actor, issue] = await Promise.all([
        octokit.rest.repos.get({ owner: intent.owner, repo: intent.repo, request: { signal } }),
        octokit.rest.users.getAuthenticated({ request: { signal } }),
        octokit.rest.issues.get({ owner: intent.owner, repo: intent.repo, issue_number: issueNumber,
            request: { signal } }),
    ]);
    return BigInt(repository.data.id) === intent.repositoryId && Boolean(repository.data.permissions?.push)
        && !issue.data.pull_request && issue.data.number === issueNumber
        && issue.data.user?.id === actor.data.id
        && issue.data.title === intent.title && issue.data.body === intent.body;
}

function safeErrorCode(error: unknown): string {
    const status = (error as { status?: number })?.status;
    if (status === 401 || status === 403) return 'authorization';
    if (status === 404) return 'repository_unavailable';
    return 'reconcile_failed';
}

export async function reconcileGithubIssueIntent(intent: AiGithubIssueIntent, now = new Date()): Promise<'found' | 'uncertain' | 'busy'> {
    const key: IntentIdentity = { accountId: intent.accountId, conversationId: intent.conversationId,
        clientMessageId: intent.clientMessageId };
    const reconcileOwner = randomUUID();
    const claimed = await db.aiGithubIssueIntent.updateMany({
        where: { ...key, status: { in: ['creating', 'uncertain'] }, issueNumber: null,
            OR: [{ reconcileLeaseUntil: null }, { reconcileLeaseUntil: { lt: now } }] },
        data: { reconcileOwner, reconcileLeaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (!claimed.count) return 'busy';
    let issueNumber: number | null = null;
    let lastErrorCode: string | null = null;
    try { issueNumber = await findGithubIssueForIntent(intent); }
    catch (error) { lastErrorCode = safeErrorCode(error); }
    const finished = await db.aiGithubIssueIntent.updateMany({
        where: { ...key, reconcileOwner, issueNumber: null },
        data: { status: issueNumber ? 'succeeded' : 'uncertain', issueNumber,
            reconcileOwner: null, reconcileLeaseUntil: null,
            reconcileAttempts: { increment: 1 }, lastCheckedAt: new Date(),
            lastErrorCode: issueNumber ? null : lastErrorCode ?? 'not_found',
        },
    });
    return finished.count ? (issueNumber ? 'found' : 'uncertain') : 'busy';
}

export async function githubIssueIntentReconcileTick(now = new Date(), accountId?: string): Promise<void> {
    const cutoff = new Date(now.getTime() - RECHECK_INTERVAL_MS);
    const intents = await db.aiGithubIssueIntent.findMany({
        where: { ...(accountId ? { accountId } : {}), status: { in: ['creating', 'uncertain'] }, issueNumber: null,
            createdAt: { lt: cutoff }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }] },
        orderBy: { createdAt: 'asc' }, take: 20,
    });
    await Promise.all(intents.map((intent) => reconcileGithubIssueIntent(intent, now)));
}

export function startGithubIssueIntentReconciler(): void {
    forever('github-issue-intent-reconcile', async () => {
        try { await githubIssueIntentReconcileTick(); }
        catch { warn({ module: 'github-issue-intent' }, 'Issue intent reconciliation tick failed'); }
        await delay(RECHECK_INTERVAL_MS, shutdownSignal);
    });
}
