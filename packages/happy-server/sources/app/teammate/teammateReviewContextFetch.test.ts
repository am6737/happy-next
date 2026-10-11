import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPull, listFiles, getIssue } = vi.hoisted(() => ({ getPull: vi.fn(), listFiles: vi.fn(), getIssue: vi.fn() }));
vi.mock('@/app/github/githubApi', () => ({ getUserOctokit: vi.fn(async () => ({ rest: { pulls: { get: getPull, listFiles }, issues: { get: getIssue } } })) }));

import { teammateReviewContextFetch } from './teammateReviewContextFetch';

const review = { type: 'task-assigned' as const, at: 1, data: { taskId: 'review', review: true, round: 1, prUrl: 'https://github.com/o/r/pull/4', issue: 'o/r#3', builderSummary: 'Fixed it' } };

describe('teammateReviewContextFetch', () => {
    beforeEach(() => {
        getPull.mockReset().mockResolvedValue({ data: { head: { ref: 'fix', repo: { full_name: 'o/r' } }, base: { ref: 'main', repo: { full_name: 'o/r' } } } });
        listFiles.mockReset().mockResolvedValue({ data: [{ filename: 'src/a.js', status: 'modified', additions: 3, deletions: 1, patch: 'ignored' }] });
        getIssue.mockReset().mockResolvedValue({ data: { title: 'Bug', body: 'x'.repeat(5_000) } });
    });

    it('adds changed files and the source issue to review assignments only', async () => {
        const other = { type: 'task-assigned' as const, at: 1, data: { taskId: 'impl' } };
        const [enriched, untouched] = await teammateReviewContextFetch('acc', [review, other]);
        expect(enriched.data).toMatchObject({ headBranch: 'fix', baseBranch: 'main', builderSummary: 'Fixed it', changedFiles: [{ path: 'src/a.js', status: 'modified', additions: 3, deletions: 1 }], issueTitle: 'Bug' });
        expect((enriched.data.issueBody as string).length).toBe(4_000);
        expect(untouched).toBe(other);
        expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ owner: 'o', repo: 'r', pull_number: 4 }));
        expect(getIssue).toHaveBeenCalledWith(expect.objectContaining({ owner: 'o', repo: 'r', issue_number: 3 }));
    });

    it('omits the head branch of fork PRs', async () => {
        getPull.mockResolvedValue({ data: { head: { ref: 'fix', repo: { full_name: 'fork/r' } }, base: { ref: 'main', repo: { full_name: 'o/r' } } } });
        const [enriched] = await teammateReviewContextFetch('acc', [review]);
        expect(enriched.data.headBranch).toBeUndefined();
        expect(enriched.data.baseBranch).toBe('main');
    });

    it('leaves the event unchanged when GitHub fails', async () => {
        listFiles.mockRejectedValue(new Error('boom'));
        expect(await teammateReviewContextFetch('acc', [review])).toEqual([review]);
    });
});
