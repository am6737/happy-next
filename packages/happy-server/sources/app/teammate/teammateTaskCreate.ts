import { TEAMMATE_TASK_CREATE_DAILY_LIMIT, TeammateTaskCreateRequestSchema, type TeammateTaskCreateRequest } from 'happy-wire';
import type { Teammate } from '@prisma/client';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { getUserOctokit, GitHubNotConnectedError } from '@/app/github/githubApi';
import { teammateRunAuthorize } from './teammateRunAuthorize';
import { teammateTaskDelegate } from './teammateTaskDelegate';
import { teammateNotify } from './teammateNotify';
import { TeammateError } from './teammateError';
import { teammateFindByRef } from './teammateIdentity';

const limitNotifiedAt = new Map<string, number>();

/** Tell the owner once per 24h per creator that new-issue creation is capped; delegating existing issues or PRs is never limited. */
async function notifyLimitReached(creator: Teammate) {
    const last = limitNotifiedAt.get(creator.id);
    if (last && Date.now() - last < 24 * 60 * 60_000) return;
    limitNotifiedAt.set(creator.id, Date.now());
    await inTx(async tx => { teammateNotify(tx, creator, 'Agent task limit reached', `${creator.name} reached the daily limit for creating new issues (${TEAMMATE_TASK_CREATE_DAILY_LIMIT}).`, { code: 'task_create_limit', teammateId: creator.id }); });
}

/** Resolve or create a marked GitHub issue or pull request, then delegate it with creator traceability. */
export async function teammateTaskCreate(accountId: string, input: TeammateTaskCreateRequest) {
    const req = TeammateTaskCreateRequestSchema.parse(input);
    const run = await teammateRunAuthorize(accountId, req.runId, req.dispatchToken);
    const creator = run.teammate;
    if (creator.status !== 'active' || !creator.canSelfAssign) throw new TeammateError('self_assign_disabled');
    if (!creator.repos.some(repo => repo.toLowerCase() === req.repo.toLowerCase())) throw new TeammateError('repo_not_allowed');
    const assignee = req.assignee ? await teammateFindByRef(db, accountId, req.assignee) : creator;
    if (!assignee) throw new TeammateError('not_found');
    const reviewer = req.reviewer
        ? await teammateFindByRef(db, accountId, req.reviewer)
        : null;
    if (req.reviewer && !reviewer) throw new TeammateError('not_found');
    if (reviewer && reviewer.id === assignee.id) throw new TeammateError('invalid_request');
    const [owner, repo] = req.repo.split('/');
    const existingTask = req.issueNumber ? await db.teammateTask.findFirst({ where: { accountId, resourceId: `${req.repo}#${req.issueNumber}`, status: { notIn: ['done', 'cancelled'] } } }) : null;
    if (existingTask && existingTask.teammateId !== assignee.id) throw new TeammateError('already_delegated');
    try {
        const octokit = await getUserOctokit(accountId);
        let issue: { number: number; title: string; html_url: string; state: string; pull_request?: unknown };
        let created = false;
        if (req.issueNumber) {
            try { issue = (await octokit.rest.issues.get({ owner, repo, issue_number: req.issueNumber })).data; }
            catch (error) { if ((error as { status?: number }).status === 404) throw new TeammateError('issue_not_found'); throw error; }
        } else {
            const marker = `<!-- happy-agent-task:${req.requestId} -->`;
            const login = (await octokit.rest.users.getAuthenticated()).data.login;
            const recent = await octokit.rest.issues.listForRepo({ owner, repo, creator: login, state: 'all', sort: 'created', direction: 'desc', per_page: 50 });
            const reused = recent.data.find((item: { body?: string | null }) => item.body?.includes(marker));
            if (reused) issue = reused;
            else {
                const count = await db.teammateTask.count({ where: { createdByTeammateId: creator.id, createdIssue: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } } });
                if (count >= TEAMMATE_TASK_CREATE_DAILY_LIMIT) {
                    await notifyLimitReached(creator);
                    throw new TeammateError('task_create_limit');
                }
                const body = `${req.body ?? ''}\n\n— 🤖 ${creator.name} (Happy Agent)\n${marker}`;
                issue = (await octokit.rest.issues.create({ owner, repo, title: req.title!, body })).data;
                created = true;
            }
        }
        if (issue.state !== 'open') throw new TeammateError('issue_not_found');
        const resourceId = `${req.repo}#${issue.number}`;
        const delegated = existingTask ?? await db.teammateTask.findFirst({ where: { accountId, resourceId, status: { notIn: ['done', 'cancelled'] } } });
        if (delegated && delegated.teammateId !== assignee.id) throw new TeammateError('already_delegated');
        let task = await teammateTaskDelegate(accountId, { teammateId: assignee.id, source: 'github-issue', resourceId, title: issue.title, url: issue.html_url, ...(issue.pull_request ? { prUrl: issue.html_url } : {}) }, creator.id, run.threadId);
        if (reviewer && !task.reviewerTeammateId) {
            await db.teammateTask.update({ where: { id: task.id }, data: { reviewerTeammateId: reviewer.id } });
            task = { ...task, reviewerTeammateId: reviewer.id };
        }
        if (created && !delegated && task.createdByTeammateId === creator.id) await db.teammateTask.update({ where: { id: task.id }, data: { createdIssue: true } });
        if (task.createdByTeammateId === creator.id && !delegated) {
            await inTx(async tx => { teammateNotify(tx, assignee, 'New agent task', `${creator.name} assigned ${task.title}`, { code: 'task_self_assigned', taskId: task.id }); });
        }
        return { task, issueUrl: issue.html_url, created };
    } catch (error) {
        if (error instanceof GitHubNotConnectedError) throw new TeammateError('github_not_connected');
        throw error;
    }
}
