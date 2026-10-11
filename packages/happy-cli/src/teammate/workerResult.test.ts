import { describe, expect, it, vi } from 'vitest';
import type { TaskWorker } from './homeDir';
import { inspectWorkerWorkspace, parseWorkerReport } from './workerResult';

const worker: TaskWorker = { sessionId: 'worker-1', keyPath: '/key', provider: 'codex', repo: 'owner/repo', basePath: '/base', worktreePath: '/base/.dev/worktree/1',
    branch: 'happy/atlas/12345678-1', baseBranch: 'develop', title: 'Fix', startedAt: 1 };
const head = 'a'.repeat(40);

describe('worker result', () => {
    it('parses the last happy-result block and strips it from the reply', () => {
        const reply = 'Fixed the bug.\n\n```happy-result\n{"status":"blocked"}\n```\nThen retried.\n```happy-result\n{"status":"done","prUrl":"https://github.com/owner/repo/pull/7","checks":[{"command":"npm test","passed":true}]}\n```';
        expect(parseWorkerReport(reply)).toEqual({
            reply: 'Fixed the bug.\n\n```happy-result\n{"status":"blocked"}\n```\nThen retried.',
            report: { status: 'done', prUrl: 'https://github.com/owner/repo/pull/7', checks: [{ command: 'npm test', passed: true }] },
        });
    });
    it('explains a missing or malformed block instead of guessing', () => {
        expect(parseWorkerReport('All done')).toEqual({ reply: 'All done', reportError: expect.stringContaining('did not end with a happy-result block') });
        expect(parseWorkerReport('```happy-result\n{status: done}\n```').reportError).toContain('Invalid happy-result JSON');
        expect(parseWorkerReport('```happy-result\n{"status":"finished"}\n```').reportError).toMatch(/Invalid happy-result block: status/);
    });
    it('checks commit, push, diff and PR itself', async () => {
        const exec = vi.fn(async (_file: string, args: string[]) => ({ stdout: {
            'rev-parse': `${head}\n`, status: ' M src/a.ts\n?? tmp.txt\n', 'ls-remote': `${head}\trefs/heads/${worker.branch}\n`, diff: ' 2 files changed, 10 insertions(+)\n',
        }[args[0]] ?? '' }));
        const fetch = vi.fn(async () => new Response(JSON.stringify([{ html_url: 'https://github.com/owner/repo/pull/7', state: 'open', draft: true, head: { sha: head } }])));
        expect(await inspectWorkerWorkspace(worker, 'token', { exec, fetch })).toEqual({
            branch: worker.branch, head, uncommittedFiles: 2, pushed: true, diff: '2 files changed, 10 insertions(+)',
            pr: { url: 'https://github.com/owner/repo/pull/7', state: 'open', draft: true, headMatches: true },
        });
        expect(exec).toHaveBeenCalledWith('git', ['diff', '--shortstat', 'origin/develop...HEAD'], expect.objectContaining({ cwd: worker.worktreePath }));
        expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo/pulls?state=all&per_page=1&head=owner%3Ahappy%2Fatlas%2F12345678-1',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
    });
    it('reports unpushed work, a missing PR and failed steps without throwing', async () => {
        const exec = vi.fn(async (_file: string, args: string[]) => {
            if (args[0] === 'diff') throw Object.assign(new Error('exit 128'), { stderr: 'fatal: bad revision\n' });
            return { stdout: args[0] === 'rev-parse' ? head : '' };
        });
        const fetch = vi.fn(async () => new Response('[]'));
        expect(await inspectWorkerWorkspace({ ...worker, baseBranch: undefined }, undefined, { exec, fetch })).toEqual({
            branch: worker.branch, head, uncommittedFiles: 0, pushed: false, pr: null, errors: ['diff: fatal: bad revision'],
        });
        expect(exec).toHaveBeenCalledWith('git', ['diff', '--shortstat', 'origin/HEAD...HEAD'], expect.anything());
        expect(await inspectWorkerWorkspace(worker, undefined, { exec, fetch: vi.fn(async () => new Response('', { status: 403 })) })).toMatchObject({ errors: ['diff: fatal: bad revision', 'pr: GitHub 403'] });
    });
});
