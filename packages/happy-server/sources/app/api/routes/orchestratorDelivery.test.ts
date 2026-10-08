import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    get: vi.fn(), issue: vi.fn(), pull: vi.fn(), checks: vi.fn(), status: vi.fn(), compare: vi.fn(),
}));
vi.mock('@/app/github/githubApi', () => ({ getUserOctokit: vi.fn(async () => ({ rest: {
    repos: { get: mocks.get, getCombinedStatusForRef: mocks.status, compareCommits: mocks.compare },
    issues: { get: mocks.issue }, pulls: { get: mocks.pull },
    checks: { listForRef: mocks.checks },
} })) }));

import { verifyGithubDeliveryMetadata } from './orchestratorRoutes';

const report = 'Created GitHub issue: https://github.com/acme/project/issues/42\n' +
    'Created pull request: https://github.com/acme/project/pull/7';
const commit = 'a'.repeat(40);

describe('GitHub delivery verification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockResolvedValue({ data: { id: 123, full_name: 'acme/project', default_branch: 'main', permissions: { push: true } } });
        mocks.issue.mockResolvedValue({ data: { number: 42 } });
        mocks.pull.mockResolvedValue({ data: { number: 7, html_url: 'https://github.com/acme/project/pull/7',
            head: { ref: 'agent/task', sha: commit, repo: { id: 123 } },
            base: { ref: 'main', repo: { id: 123 } }, body: 'Closes #42', state: 'open', merged: false } });
        mocks.checks.mockResolvedValue({ data: { check_runs: [{ status: 'completed', conclusion: 'success' }] } });
        mocks.status.mockResolvedValue({ data: { total_count: 1, state: 'success' } });
        mocks.compare.mockResolvedValue({ data: { status: 'ahead' } });
    });

    it('uses the marker only after authenticated GitHub identity and checks agree', async () => {
        expect(await verifyGithubDeliveryMetadata('account', report, 'agent/task', commit, 123n)).toMatchObject({
            issue: { resourceId: 'acme/project#42' }, repositoryId: 123n,
            pullRequest: { number: 7 }, state: 'open',
        });
        expect(mocks.pull).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'project', pull_number: 7 }));
    });

    it('rejects a PR with the wrong commit or failing checks', async () => {
        expect(await verifyGithubDeliveryMetadata('account', report, 'agent/task', 'wrong', 123n)).toBeNull();
        mocks.checks.mockResolvedValue({ data: { check_runs: [{ status: 'completed', conclusion: 'failure' }] } });
        expect(await verifyGithubDeliveryMetadata('account', report, 'agent/task', commit, 123n)).toBeNull();
    });

    it('rejects a different repository or missing CI and accepts a descendant head', async () => {
        expect(await verifyGithubDeliveryMetadata('account', report, 'agent/task', commit, 999n)).toBeNull();
        mocks.checks.mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
        mocks.status.mockResolvedValue({ data: { total_count: 0, state: 'pending' } });
        expect(await verifyGithubDeliveryMetadata('account', report, 'agent/task', commit, 123n)).toBeNull();
        mocks.checks.mockResolvedValue({ data: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] } });
        mocks.status.mockResolvedValue({ data: { total_count: 1, state: 'success' } });
        mocks.pull.mockResolvedValue({ data: { number: 7, html_url: 'https://github.com/acme/project/pull/7',
            head: { ref: 'agent/task', sha: 'b'.repeat(40), repo: { id: 123 } },
            base: { ref: 'main', repo: { id: 123 } }, body: 'Closes #42', state: 'open', merged: false } });
        expect(await verifyGithubDeliveryMetadata('account', report, 'agent/task', commit, 123n)).toMatchObject({
            pullRequest: { number: 7 },
        });
        expect(mocks.compare).toHaveBeenCalledWith(expect.objectContaining({ base: commit, head: 'b'.repeat(40) }));
    });
});
