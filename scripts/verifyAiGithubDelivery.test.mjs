import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeliveryFile, verifyDeliveryIdentity } from './verifyAiGithubDelivery.mjs';

const expected = { repo: 'owner/repo', issue: 12, pr: 3, branch: 'agent/task', commit: 'a'.repeat(40) };
function fixture() {
    return {
        repository: { full_name: 'owner/repo', id: 7, default_branch: 'main' },
        issue: { number: 12 },
        pullRequest: { number: 3, state: 'open', merged: false, body: 'Closes #12',
            base: { repo: { id: 7 }, ref: 'main' }, head: { repo: { id: 7 }, ref: 'agent/task', sha: expected.commit } },
        commits: [{ sha: expected.commit }],
        checks: { check_runs: [{ name: 'test', head_sha: expected.commit, status: 'completed', conclusion: 'success' }] },
    };
}

test('accepts independently verified repository, branch, Issue and successful commit checks', () => {
    verifyDeliveryIdentity(fixture(), expected);
    for (const body of ['Fixes owner/repo#12', 'Resolves https://github.com/owner/repo/issues/12']) {
        const value = fixture(); value.pullRequest.body = body;
        verifyDeliveryIdentity(value, expected);
    }
});

test('accepts successful legacy status CI and rejects pending or mismatched commit statuses', () => {
    const value = { ...fixture(), statuses: { total_count: 1, sha: expected.commit, state: 'success' } };
    value.checks.check_runs = [];
    verifyDeliveryIdentity(value, expected);
    value.statuses.state = 'pending';
    assert.throws(() => verifyDeliveryIdentity(value, expected));
    value.statuses.state = 'success';
    value.statuses.sha = 'b'.repeat(40);
    assert.throws(() => verifyDeliveryIdentity(value, expected));
});

test('rejects wrong Issue, tenant/repo, branch, commit, merged PR and absent/failed checks', () => {
    const cases = [
        (value) => { value.pullRequest.body = 'Closes #123'; },
        (value) => { value.pullRequest.body = 'Closes #12abc'; },
        (value) => { value.pullRequest.body = 'Closes outsider/repo#12'; },
        (value) => { value.pullRequest.base.repo.id = 99; },
        (value) => { value.pullRequest.head.ref = 'old-task'; },
        (value) => { value.pullRequest.head.sha = 'b'.repeat(40); },
        (value) => { value.pullRequest.merged = true; },
        (value) => { value.checks.check_runs = []; },
        (value) => { value.checks.check_runs[0].conclusion = 'failure'; },
        (value) => { value.issue.pull_request = {}; },
    ];
    for (const mutate of cases) {
        const value = fixture(); mutate(value);
        assert.throws(() => verifyDeliveryIdentity(value, expected));
    }
});

test('verifies exact bytes, rejecting truncation, omitted newline and altered binary bytes', () => {
    const expected = Buffer.from('correct content\n');
    const content = { type: 'file', encoding: 'base64', size: expected.length, content: expected.toString('base64') };
    assert.equal(verifyDeliveryFile(content, expected), expected.length);
    assert.throws(() => verifyDeliveryFile({ ...content, content: expected.subarray(0, -1).toString('base64') }, expected));
    assert.throws(() => verifyDeliveryFile({ ...content, size: expected.length - 1, content: expected.subarray(0, -1).toString('base64') }, expected));
    const altered = Buffer.from(expected); altered[0] ^= 1;
    assert.throws(() => verifyDeliveryFile({ ...content, content: altered.toString('base64') }, expected));
});
