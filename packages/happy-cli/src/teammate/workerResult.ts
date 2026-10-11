import { z } from 'zod';
import type { TaskWorker } from './homeDir';
import { githubGitEnv, type WorkspaceDependencies } from './workspace';

/** Appended to implementation worker prompts so the controller gets a parseable result instead of prose. */
export const WORKER_RESULT_INSTRUCTION = [
    '', '',
    'When you finish, end your final message with this block, filled in as valid JSON:',
    '```happy-result',
    '{"status": "done", "prUrl": "<PR URL, if you opened one>", "checks": [{"command": "<each check you ran>", "passed": true}], "notes": "<what the reviewer or owner must know>"}',
    '```',
    'Use "status": "blocked" with the reason in notes if you could not finish. List only checks you actually ran in their final state.',
].join('\n');
export const WORKER_RESULT_REMINDER = '\n\nEnd your final message with an updated happy-result block.';

const WorkerReportSchema = z.object({
    status: z.enum(['done', 'blocked']),
    prUrl: z.string().url().optional(),
    checks: z.array(z.object({ command: z.string(), passed: z.boolean() })).default([]),
    notes: z.string().optional(),
});
export type WorkerReport = z.infer<typeof WorkerReportSchema>;

/** The last happy-result block of a reply; the reply comes back without it so it is not shown twice. */
export function parseWorkerReport(reply: string): { reply: string; report?: WorkerReport; reportError?: string } {
    const blocks = [...reply.matchAll(/```happy-result[^\n]*\n([\s\S]*?)```/g)];
    const block = blocks.pop();
    if (!block) return { reply, reportError: 'The worker did not end with a happy-result block.' };
    const stripped = (reply.slice(0, block.index) + reply.slice(block.index! + block[0].length)).trim();
    try {
        const parsed = WorkerReportSchema.safeParse(JSON.parse(block[1]));
        if (parsed.success) return { reply: stripped, report: parsed.data };
        return { reply: stripped, reportError: `Invalid happy-result block: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` };
    } catch (error) {
        return { reply: stripped, reportError: `Invalid happy-result JSON: ${(error as Error).message}` };
    }
}

export interface WorkerFacts {
    branch: string; head?: string; uncommittedFiles?: number; pushed?: boolean; diff?: string;
    pr?: { url: string; state: string; draft: boolean; headMatches: boolean } | null;
    errors?: string[];
}

/** Facts the daemon checks itself, so the controller need not re-run git or query GitHub. */
export async function inspectWorkerWorkspace(worker: TaskWorker, token: string | undefined, deps: {
    exec: NonNullable<WorkspaceDependencies['exec']>; fetch: typeof fetch;
}): Promise<WorkerFacts> {
    // Keys in a fixed order keep the wake message stable; checks that fail stay undefined and drop out of the JSON.
    const facts: WorkerFacts = { branch: worker.branch, head: undefined, uncommittedFiles: undefined, pushed: undefined, diff: undefined, pr: undefined };
    const git = (args: string[]) => deps.exec('git', args, { cwd: worker.worktreePath, env: { ...process.env, ...githubGitEnv(token) }, timeout: 30_000 })
        .then(result => result.stdout.trim());
    let remoteHead: string | undefined;
    let pr: { html_url: string; state: string; draft: boolean; head: { sha: string } } | undefined | null;
    // Independent checks run together; push and PR are compared with HEAD once all are in.
    const errors = (await Promise.all(Object.entries({
        head: async () => { facts.head = await git(['rev-parse', 'HEAD']); },
        status: async () => { facts.uncommittedFiles = (await git(['status', '--porcelain'])).split('\n').filter(Boolean).length; },
        push: async () => { remoteHead = (await git(['ls-remote', 'origin', `refs/heads/${worker.branch}`])).split(/\s/)[0]; },
        diff: async () => { facts.diff = await git(['diff', '--shortstat', `${worker.baseBranch ? `origin/${worker.baseBranch}` : 'origin/HEAD'}...HEAD`]) || 'no changes'; },
        pr: async () => {
            const response = await deps.fetch(`https://api.github.com/repos/${worker.repo}/pulls?state=all&per_page=1&head=${encodeURIComponent(`${worker.repo.split('/')[0]}:${worker.branch}`)}`, {
                headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) throw new Error(`GitHub ${response.status}`);
            pr = (await response.json() as NonNullable<typeof pr>[])[0] ?? null;
        },
    }).map(([name, work]) => work().then(() => null, error => `${name}: ${String((error as { stderr?: unknown }).stderr || (error as Error).message).trim().split('\n').pop()}`))))
        .filter((error): error is string => error !== null);
    if (remoteHead !== undefined) facts.pushed = remoteHead === facts.head;
    if (pr !== undefined) facts.pr = pr && { url: pr.html_url, state: pr.state, draft: pr.draft, headMatches: pr.head.sha === facts.head };
    return errors.length ? { ...facts, errors } : facts;
}
