import { Webhooks } from "@octokit/webhooks";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { log } from "@/utils/log";
import type { Prisma } from '@prisma/client';

let webhooks: Webhooks | null = null;

export async function applyGithubGrantRevocation(tx: Prisma.TransactionClient, event: string, payload: {
    action?: string;
    installation?: { id?: number };
    repositories_removed?: Array<{ id?: number }>;
    sender?: { id?: number };
}): Promise<number> {
    const installationId = payload.installation?.id;
    if (event === 'installation' && ['deleted', 'suspend'].includes(payload.action ?? '')
        && Number.isSafeInteger(installationId) && installationId! > 0) {
        const result = await tx.aiGithubRepositoryGrant.deleteMany({ where: { installationId: BigInt(installationId!) } });
        return result.count;
    }
    if (event === 'installation_repositories' && payload.action === 'removed'
        && Number.isSafeInteger(installationId) && installationId! > 0) {
        const ids = payload.repositories_removed?.map((repository) => repository.id)
            .filter((id): id is number => Number.isSafeInteger(id) && (id ?? 0) > 0) ?? [];
        if (!ids.length) return 0;
        const result = await tx.aiGithubRepositoryGrant.deleteMany({ where: {
            installationId: BigInt(installationId!), repositoryId: { in: ids.map(BigInt) },
        } });
        return result.count;
    }
    if (event === 'github_app_authorization' && payload.action === 'revoked'
        && Number.isSafeInteger(payload.sender?.id) && payload.sender!.id! > 0) {
        const result = await tx.aiGithubRepositoryGrant.deleteMany({ where: {
            accountId: { in: (await tx.account.findMany({ where: { githubUserId: String(payload.sender!.id) },
                select: { id: true } })).map((account) => account.id) },
        } });
        return result.count;
    }
    return 0;
}

export async function applyAuthorizedPullRequestEvent(tx: Prisma.TransactionClient, payload: {
    action?: string;
    installation?: { id?: number };
    repository?: { id?: number; full_name?: string };
    pull_request?: { number?: number; html_url?: string; title?: string; body?: string | null; merged?: boolean | null; merged_at?: string | null; state?: string; updated_at?: string; head?: { ref?: string; sha?: string } };
}): Promise<number> {
    const repository = payload.repository;
    const pr = payload.pull_request;
    if (!repository?.id || !repository.full_name || !pr?.number || !pr.html_url) return 0;
    const grants = await tx.aiGithubRepositoryGrant.findMany({
        where: {
            repositoryId: BigInt(repository.id), fullName: repository.full_name,
            installationId: payload.installation?.id ? BigInt(payload.installation.id) : null,
        },
        select: { accountId: true },
    });
    if (!grants.length) return 0;
    const issueNumbers = [...new Set([...`${pr.title ?? ''}\n${pr.body ?? ''}`.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)].map((match) => match[1]))];
    if (!issueNumbers.length) return 0;
    const merged = payload.action === 'closed' && pr.merged === true;
    let count = 0;
    for (const account of grants) {
        const linked = await tx.aiWorkItem.findMany({
            where: {
                accountId: account.accountId, sourceType: 'github',
                sourceResourceId: { in: issueNumbers.map((number) => `${repository.full_name}#${number}`) },
            },
            select: { id: true, orchestratorTaskId: true, pullRequestNumber: true, pullRequestState: true, pullRequestUrl: true, pullRequestEventAt: true },
        });
        for (const work of linked) {
            if (work.pullRequestState === 'merged') continue;
            if (work.pullRequestNumber && work.pullRequestNumber !== pr.number) continue;
            if (work.pullRequestUrl && work.pullRequestUrl !== pr.html_url) continue;
            const task = await tx.orchestratorTask.findUnique({ where: { id: work.orchestratorTaskId },
                select: { branchName: true, commitSha: true } });
            if (!task?.branchName || task.branchName !== pr.head?.ref) continue;
            if (task.commitSha && task.commitSha !== pr.head?.sha) continue;
            const eventAt = pr.updated_at ? new Date(pr.updated_at) : null;
            if (work.pullRequestEventAt && (!eventAt || eventAt < work.pullRequestEventAt)) continue;
            // A closed PR without merge is not an accepted delivery.
            const result = await tx.aiWorkItem.updateMany({
                where: { id: work.id, accountId: account.accountId,
                    AND: [{ OR: [{ pullRequestState: null }, { pullRequestState: { not: 'merged' } }] }],
                    ...(eventAt ? { OR: [{ pullRequestEventAt: null }, { pullRequestEventAt: { lte: eventAt } }] } : { pullRequestEventAt: null }) },
                data: {
                    pullRequestNumber: pr.number, pullRequestUrl: pr.html_url,
                    pullRequestState: merged ? 'merged' : payload.action === 'closed' ? 'closed' : pr.state ?? 'open',
                    ...(eventAt ? { pullRequestEventAt: eventAt } : {}),
                    ...(merged ? { requiresDecision: true, pullRequestMergedAt: pr.merged_at ? new Date(pr.merged_at) : new Date() } : {}),
                },
            });
            count += result.count;
        }
    }
    return count;
}

export async function initGithub() {
    webhooks = null;
    // Optional repository webhooks are independent of OAuth user authorization.
    if (process.env.GITHUB_WEBHOOK_SECRET) {
        webhooks = new Webhooks({
            secret: process.env.GITHUB_WEBHOOK_SECRET
        });
        
        // Register type-safe event handlers
        registerWebhookHandlers();
    }
}

function registerWebhookHandlers() {
    if (!webhooks) return;
    
    // Type-safe handlers for specific events
    webhooks.on("push", async ({ id, name, payload }: EmitterWebhookEvent<"push">) => {
        log({ module: 'github-webhook', event: 'push' }, 
            `Push to ${payload.repository.full_name} by ${payload.pusher.name}`);
    });
    
    webhooks.on("pull_request", async ({ id, name, payload }: EmitterWebhookEvent<"pull_request">) => {
        log({ module: 'github-webhook', event: 'pull_request' }, 
            `PR ${payload.action} on ${payload.repository.full_name}: #${payload.pull_request.number} - ${payload.pull_request.title}`);
        // The HTTP route applies PR changes and delivery completion in one transaction.
    });
    
    webhooks.on("issues", async ({ id, name, payload }: EmitterWebhookEvent<"issues">) => {
        log({ module: 'github-webhook', event: 'issues' }, 
            `Issue ${payload.action} on ${payload.repository.full_name}: #${payload.issue.number} - ${payload.issue.title}`);
    });
    
    webhooks.on(["star.created", "star.deleted"], async ({ id, name, payload }: EmitterWebhookEvent<"star.created" | "star.deleted">) => {
        const action = payload.action === 'created' ? 'starred' : 'unstarred';
        log({ module: 'github-webhook', event: 'star' }, 
            `Repository ${action}: ${payload.repository.full_name} by ${payload.sender.login}`);
    });
    
    webhooks.on("repository", async ({ id, name, payload }: EmitterWebhookEvent<"repository">) => {
        log({ module: 'github-webhook', event: 'repository' }, 
            `Repository ${payload.action}: ${payload.repository.full_name}`);
    });
    
    // Catch-all for unhandled events
    webhooks.onAny(async ({ id, name, payload }: EmitterWebhookEvent) => {
        log({ module: 'github-webhook', event: name as string }, 
            `Received webhook event: ${name}`, { id });
    });
    
    webhooks.onError((error: any) => {
        log({ module: 'github-webhook', level: 'error' }, 
            `Webhook handler error: ${error.event?.name}`, error);
    });
}

export function getWebhooks(): Webhooks | null {
    return webhooks;
}
