import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifyDeliveryIdentity({ repository, issue, pullRequest, commits, checks, statuses }, expected) {
    assert.equal(repository.full_name.toLowerCase(), expected.repo.toLowerCase(), 'Repository identity differs');
    assert.equal(issue.number, expected.issue, 'Issue number differs');
    assert.equal(issue.pull_request, undefined, 'The linked resource is a PR, not an Issue');
    assert.equal(pullRequest.number, expected.pr, 'PR number differs');
    assert.equal(pullRequest.base.repo.id, repository.id, 'PR targets a different repository');
    assert.equal(pullRequest.base.ref, repository.default_branch, 'PR targets a different base branch');
    assert.equal(pullRequest.head.repo.id, repository.id, 'PR head is in a different repository');
    assert.equal(pullRequest.head.ref, expected.branch, 'PR branch differs');
    assert.equal(pullRequest.head.sha, expected.commit, 'PR head commit differs');
    assert.ok(commits.some((commit) => commit.sha === expected.commit), 'Expected commit is absent from PR');
    assert.equal(pullRequest.merged, false, 'Acceptance must not silently merge the PR');
    assert.equal(pullRequest.state, 'open', 'Delivery PR is not open for human review');
    // Accept explicit local or fully-qualified issue references; reject #12
    // matching #123, and reject references to another repository.
    const escapedRepo = expected.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const closing = new RegExp(`\\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+(?:${escapedRepo})?#${expected.issue}\\b`, 'i');
    const urlClosing = new RegExp(`\\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+https://github\\.com/${escapedRepo}/issues/${expected.issue}\\b`, 'i');
    assert.ok(closing.test(pullRequest.body ?? '') || urlClosing.test(pullRequest.body ?? ''), 'PR does not close the expected Issue');
    assert.ok(checks.check_runs.length > 0 || (statuses?.total_count ?? 0) > 0, 'No independent CI checks exist for this commit');
    for (const check of checks.check_runs) {
        assert.equal(check.head_sha, expected.commit, 'Check refers to a different commit');
        assert.equal(check.status, 'completed', `Check ${check.name} is incomplete`);
        assert.equal(check.conclusion, 'success', `Check ${check.name} did not succeed`);
    }
    if ((statuses?.total_count ?? 0) > 0) {
        assert.equal(statuses.sha, expected.commit, 'Commit statuses refer to another commit');
        assert.equal(statuses.state, 'success', 'Combined commit status did not succeed');
    }
}

export function verifyDeliveryFile(content, expectedBytes) {
    assert.equal(content.type, 'file');
    assert.equal(content.encoding, 'base64', 'Cannot independently verify the returned file bytes');
    const actual = Buffer.from(content.content, 'base64');
    assert.equal(actual.length, content.size, 'GitHub content was truncated');
    assert.ok(actual.equals(expectedBytes), 'Delivered file differs byte-for-byte');
    return actual.length;
}

const api = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }));

export function main(args = process.argv.slice(2)) {
    const [repo, issueText, prText, branch, commit, file, expectedPath] = args;
    assert.equal(args.length, 7, 'Usage: node scripts/verifyAiGithubDelivery.mjs owner/repo issue pr branch commit file expected-local-file');
    assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
    assert.match(commit, /^[0-9a-f]{40}$/i, 'Expected a full commit SHA');
    const issueNumber = Number(issueText);
    const prNumber = Number(prText);
    assert.ok(Number.isSafeInteger(issueNumber) && issueNumber > 0);
    assert.ok(Number.isSafeInteger(prNumber) && prNumber > 0);
    const repository = api(`repos/${repo}`);
    assert.equal(repository.permissions?.push, true, 'Test account lacks write access');
    const issue = api(`repos/${repo}/issues/${issueNumber}`);
    const pullRequest = api(`repos/${repo}/pulls/${prNumber}`);
    // --paginate is needed: do not silently limit identity checks to page one.
    const commits = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/commits?per_page=100`], { encoding: 'utf8', timeout: 30_000 })).flat();
    const checkPages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/commits/${commit}/check-runs?per_page=100`], { encoding: 'utf8', timeout: 30_000 }));
    const checks = { check_runs: checkPages.flatMap((page) => page.check_runs) };
    const statuses = api(`repos/${repo}/commits/${commit}/status`);
    verifyDeliveryIdentity({ repository, issue, pullRequest, commits, checks, statuses }, { repo, issue: issueNumber, pr: prNumber, branch, commit });
    assert.ok(!file.startsWith('/') && !file.split('/').some((part) => !part || part === '..' || part === '.'), 'Expected a relative repository file');
    const encodedFile = file.split('/').map(encodeURIComponent).join('/');
    const content = api(`repos/${repo}/contents/${encodedFile}?ref=${commit}`);
    const bytes = verifyDeliveryFile(content, readFileSync(expectedPath));
    console.log(JSON.stringify({ verified: true, repo: repository.full_name, issue: issue.html_url, pullRequest: pullRequest.html_url, branch, commit, file, bytes, checks: checks.check_runs.length, commitStatuses: statuses.total_count }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Delivery verification failed'); process.exitCode = 1; }
}
