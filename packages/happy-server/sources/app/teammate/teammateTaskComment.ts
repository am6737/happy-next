import { db } from '@/storage/db';
import { TeammateTaskCommentRequestSchema, type TeammateTaskCommentRequest } from 'happy-wire';
import { getUserOctokit, GitHubNotConnectedError } from '@/app/github/githubApi';
import { teammateRunAuthorize } from './teammateRunAuthorize';
import { TeammateError } from './teammateError';

const pendingComments = new Map<string, Promise<{ url: string }>>();

/** Post on the authorized issue with one trailing signature; serialize retries and reuse an identical GitHub comment. */
export async function teammateTaskComment(accountId: string, input: TeammateTaskCommentRequest) {
    const req = TeammateTaskCommentRequestSchema.parse(input);
    const run = await teammateRunAuthorize(accountId, req.runId, req.dispatchToken);
    if (run.thread.kind !== 'task' || !run.thread.taskId) throw new TeammateError('invalid_request');
    const task = await db.teammateTask.findFirst({ where: { id: run.thread.taskId, accountId, teammateId: run.teammateId } });
    if (!task) throw new TeammateError('not_found');
    const match = task.source === 'github-issue' && task.resourceId?.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9]\d*)$/);
    if (!match) throw new TeammateError('invalid_request');
    const signature = `\n\n— 🤖 ${run.teammate.name} (Happy Agent)`;
    const body = req.body.endsWith(signature) ? req.body : req.body + signature;
    const lockKey = `${accountId}:${task.resourceId}`;
    const previous = pendingComments.get(lockKey);
    const posting = (async () => {
        if (previous) await previous.catch(() => {});
        try {
            const octokit = await getUserOctokit(accountId);
            const issue = { owner: match[1], repo: match[2], issue_number: Number(match[3]) };
            // GitHub has no idempotency key for comments: reconcile the signed body before posting.
            for (let page = 1; ; page++) {
                const comments = await octokit.rest.issues.listComments({ ...issue, per_page: 100, page });
                const existing = comments.data.find((comment: { body?: string | null; html_url: string }) => comment.body === body);
                if (existing) return { url: existing.html_url };
                if (comments.data.length < 100) break;
            }
            const result = await octokit.rest.issues.createComment({ ...issue, body });
            return { url: result.data.html_url };
        } catch (error) {
            if (error instanceof GitHubNotConnectedError) throw new TeammateError('github_not_connected');
            throw error;
        }
    })();
    pendingComments.set(lockKey, posting);
    try { return await posting; }
    finally { if (pendingComments.get(lockKey) === posting) pendingComments.delete(lockKey); }
}
