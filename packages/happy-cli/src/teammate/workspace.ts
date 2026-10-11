import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileAsync, exists, isPathId } from './homeDir';

const GIT_FETCH_TIMEOUT_MS = 45_000;
export const GIT_FETCH_ATTEMPTS = 3;
/** Abort HTTP transfers that stay below 1 KB/s for 20s instead of waiting for the process timeout. */
const GIT_STALL_ENV = { GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '20' };

export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Auth is process-local: neither the remote URL nor git config receives credentials. Extra entries follow the auth header. */
export function githubGitEnv(token?: string, config: [string, string][] = []): NodeJS.ProcessEnv {
    const entries: [string, string][] = [
        ...(token ? [['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] as [string, string]] : []),
        ...config,
    ];
    return {
        GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: String(entries.length),
        ...Object.fromEntries(entries.flatMap(([key, value], index) => [[`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]])),
    };
}

export interface Workspace { basePath: string; worktreePath: string; branch: string }
export interface WorkspaceOptions {
    home: string; repo: string; taskId: string; handle: string; token?: string; baseBranch?: string;
    continueFrom?: Workspace;
}
export interface WorkspaceDependencies {
    originUrlBase?: string;
    exec?: (file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeout: number }) => Promise<{ stdout: string }>;
}

/** One queue per base clone covers clone, fetch and branch/worktree allocation. */
export function createWorkspaceManager(deps: WorkspaceDependencies = {}) {
    const execute = deps.exec ?? execFileAsync;
    const queues = new Map<string, Promise<unknown>>();
    return async (options: WorkspaceOptions): Promise<Workspace> => {
        const { home, repo, taskId, handle, token, baseBranch, continueFrom } = options;
        if (!REPO_PATTERN.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GitHub repository');
        if (![taskId, handle].every(isPathId)) throw new Error('Invalid workspace path ID');
        if (baseBranch && (baseBranch.startsWith('-') || /[\s~^:?*\[\\]/.test(baseBranch) || baseBranch.includes('..'))) throw new Error('Invalid base branch');
        const basePath = join(home, 'workspaces', ...repo.split('/'));
        const work = (queues.get(basePath) ?? Promise.resolve()).catch(() => {}).then(async () => {
            const git = async (args: string[], cwd?: string, timeout = 120_000, attempts = 1) => {
                for (let attempt = 1; ; attempt++) {
                    try { return await execute('git', args, { cwd, env: { ...process.env, ...githubGitEnv(token), ...GIT_STALL_ENV }, timeout }); }
                    catch (error) {
                        if (attempt < attempts) continue;
                        const reason = String((error as { stderr?: unknown }).stderr ?? '').trim().split('\n').pop();
                        throw new Error(`Git ${args[0]} failed for ${repo}; check repository access and GitHub connection${reason ? ` (${reason})` : ''}`);
                    }
                }
            };
            // Callers pass a whole worker record; never let its session fields leak into the new worker.
            if (continueFrom) return { basePath: continueFrom.basePath, worktreePath: continueFrom.worktreePath, branch: continueFrom.branch };
            if (!await exists(join(basePath, '.git'))) {
                // Clone beside the target and rename on success, so a killed clone never looks like a usable base.
                const partialPath = `${basePath}.partial`;
                await mkdir(join(home, 'workspaces', repo.split('/')[0]), { recursive: true });
                await rm(partialPath, { recursive: true, force: true });
                await git(['clone', `${(deps.originUrlBase ?? 'https://github.com').replace(/\/$/, '')}/${repo}.git`, partialPath], undefined, 15 * 60_000);
                await rm(basePath, { recursive: true, force: true });
                await rename(partialPath, basePath);
            }
            // A stalled fetch is usually transient: abort it early and retry instead of blocking the worker for minutes.
            await git(['fetch', 'origin', '--prune'], basePath, GIT_FETCH_TIMEOUT_MS, GIT_FETCH_ATTEMPTS);
            const defaultBranch = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], basePath)
                .then(result => result.stdout.trim().replace(/^refs\/remotes\/origin\//, ''), () => 'main');
            const short = taskId.slice(-8);
            let n = 1;
            for (;;) {
                const branch = `happy/${handle}/${short}-${n}`;
                const worktreePath = join(basePath, '.dev', 'worktree', `${short}-${n}`);
                const [pathExists, branchExists] = await Promise.all([exists(worktreePath),
                    git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], basePath).then(() => true, () => false)]);
                if (!pathExists && !branchExists) {
                    await mkdir(join(basePath, '.dev', 'worktree'), { recursive: true });
                    await git(['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch ?? defaultBranch}`], basePath);
                    return { basePath, worktreePath, branch };
                }
                n++;
            }
        });
        queues.set(basePath, work);
        try { return await work; }
        finally { if (queues.get(basePath) === work) queues.delete(basePath); }
    };
}
