import type { TeammateRunEvent } from 'happy-wire';
import { getUserOctokit } from '@/app/github/githubApi';

export const TEAMMATE_REVIEW_CONTEXT_MAX_FILES = 100;
export const TEAMMATE_REVIEW_CONTEXT_MAX_BODY = 4_000;
export const TEAMMATE_REVIEW_CONTEXT_TIMEOUT_MS = 10_000;

/**
 * Adds the PR's branches, changed files and the source issue to review assignments right before dispatch, so the
 * reviewer can run the built-in review on the PR branch without fetching any of it again. Runs outside transactions.
 * Any GitHub failure leaves the event unchanged; the reviewer then fetches the context itself.
 */
export async function teammateReviewContextFetch(accountId: string, events: TeammateRunEvent[]): Promise<TeammateRunEvent[]> {
    return Promise.all(events.map(async event => {
        if (event.type !== 'task-assigned' || event.data.review !== true || typeof event.data.prUrl !== 'string') return event;
        const pr = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(event.data.prUrl);
        if (!pr) return event;
        try {
            const octokit = await getUserOctokit(accountId);
            const pull = (await octokit.rest.pulls.get({ owner: pr[1], repo: pr[2], pull_number: Number(pr[3]), request: { signal: AbortSignal.timeout(TEAMMATE_REVIEW_CONTEXT_TIMEOUT_MS) } })).data;
            const files = await octokit.rest.pulls.listFiles({ owner: pr[1], repo: pr[2], pull_number: Number(pr[3]), per_page: TEAMMATE_REVIEW_CONTEXT_MAX_FILES, request: { signal: AbortSignal.timeout(TEAMMATE_REVIEW_CONTEXT_TIMEOUT_MS) } });
            const issue = typeof event.data.issue === 'string' ? /^([^/]+)\/([^#]+)#(\d+)$/.exec(event.data.issue) : null;
            const issueData = issue ? (await octokit.rest.issues.get({ owner: issue[1], repo: issue[2], issue_number: Number(issue[3]), request: { signal: AbortSignal.timeout(TEAMMATE_REVIEW_CONTEXT_TIMEOUT_MS) } })).data : null;
            return { ...event, data: {
                ...event.data,
                // Fork heads are not on origin, so the reviewer can only check out same-repo branches.
                ...(pull.head.repo?.full_name === pull.base.repo.full_name ? { headBranch: pull.head.ref } : {}),
                baseBranch: pull.base.ref,
                changedFiles: files.data.map((file: { filename: string; status: string; additions: number; deletions: number }) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions })),
                ...(issueData ? { issueTitle: issueData.title, issueBody: (issueData.body ?? '').slice(0, TEAMMATE_REVIEW_CONTEXT_MAX_BODY) } : {}),
            } };
        } catch {
            return event;
        }
    }));
}
