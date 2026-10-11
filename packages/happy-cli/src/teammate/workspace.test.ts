import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_FETCH_ATTEMPTS, createWorkspaceManager, githubGitEnv } from './workspace';

const execute = promisify(execFile);
describe('task workspaces', () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'happy-task-git-')); });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    it('clones, serializes worktrees, reuses continueFrom and keeps auth out of argv and disk', async () => {
        const originBase = join(dir, 'origin');
        const bare = join(originBase, 'owner', 'repo.git');
        const seed = join(dir, 'seed');
        await mkdir(join(originBase, 'owner'), { recursive: true });
        await mkdir(seed);
        const git = (args: string[], cwd?: string) => execute('git', args, { cwd, timeout: 10000 });
        await git(['init', '--bare', '--initial-branch=main', bare]);
        await git(['init', '--initial-branch=main', seed]);
        await writeFile(join(seed, 'README.md'), 'one commit\n');
        await git(['add', 'README.md'], seed);
        await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], seed);
        await git(['remote', 'add', 'origin', bare], seed);
        await git(['push', 'origin', 'main'], seed);
        const captured: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
        const workspace = createWorkspaceManager({ originUrlBase: originBase, exec: async (file, args, options) => {
            captured.push({ args, env: options.env });
            return execute(file, args, options);
        } });
        const options = { home: join(dir, 'agent'), repo: 'owner/repo', taskId: 'task-12345678', handle: 'atlas', token: 'secret-fixture-token' };
        const [first, second] = await Promise.all([workspace(options), workspace(options)]);
        expect(first.branch).toBe('happy/atlas/12345678-1');
        expect(second.branch).toBe('happy/atlas/12345678-2');
        expect(first.worktreePath).toBe(join(first.basePath, '.dev/worktree/12345678-1'));
        expect((await git(['branch', '--show-current'], first.worktreePath)).stdout.trim()).toBe(first.branch);
        expect(await readFile(join(second.worktreePath, 'README.md'), 'utf8')).toBe('one commit\n');
        expect(await workspace({ ...options, continueFrom: first })).toEqual(first);
        expect(captured.filter(call => call.args[0] === 'clone')).toHaveLength(1);
        expect(captured.filter(call => call.args[0] === 'fetch')).toHaveLength(2);
        const auth = githubGitEnv(options.token).GIT_CONFIG_VALUE_0!;
        for (const call of captured.filter(call => ['clone', 'fetch'].includes(call.args[0]))) {
            expect(call.env).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: auth, GIT_TERMINAL_PROMPT: '0' });
        }
        const config = await readFile(join(first.basePath, '.git/config'), 'utf8');
        for (const secret of [options.token, auth, Buffer.from(`x-access-token:${options.token}`).toString('base64')]) {
            expect(config).not.toContain(secret);
            expect(JSON.stringify(captured.map(call => call.args))).not.toContain(secret);
        }
    });

    it('leaves no usable-looking base behind when a clone fails, so the next attempt clones again', async () => {
        const originBase = join(dir, 'origin');
        const bare = join(originBase, 'owner', 'repo.git');
        const seed = join(dir, 'seed');
        await mkdir(join(originBase, 'owner'), { recursive: true });
        await mkdir(seed);
        const git = (args: string[], cwd?: string) => execute('git', args, { cwd, timeout: 10000 });
        await git(['init', '--bare', '--initial-branch=main', bare]);
        await git(['init', '--initial-branch=main', seed]);
        await writeFile(join(seed, 'README.md'), 'one commit\n');
        await git(['add', 'README.md'], seed);
        await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], seed);
        await git(['remote', 'add', 'origin', bare], seed);
        await git(['push', 'origin', 'main'], seed);
        let failClone = true;
        const workspace = createWorkspaceManager({ originUrlBase: originBase, exec: async (file, args, options) => {
            if (args[0] === 'clone' && failClone) {
                failClone = false;
                await mkdir(join(args[2], '.git'), { recursive: true });
                throw new Error('killed by timeout');
            }
            return execute(file, args, options);
        } });
        const options = { home: join(dir, 'agent'), repo: 'owner/repo', taskId: 'task-12345678', handle: 'atlas' };
        await expect(workspace(options)).rejects.toThrow('Git clone failed');
        const first = await workspace(options);
        expect(await readFile(join(first.worktreePath, 'README.md'), 'utf8')).toBe('one commit\n');
    });

    it('retries a failed fetch and reports git\'s last error line once retries run out', async () => {
        const originBase = join(dir, 'origin');
        const bare = join(originBase, 'owner', 'repo.git');
        const seed = join(dir, 'seed');
        await mkdir(join(originBase, 'owner'), { recursive: true });
        await mkdir(seed);
        const git = (args: string[], cwd?: string) => execute('git', args, { cwd, timeout: 10000 });
        await git(['init', '--bare', '--initial-branch=main', bare]);
        await git(['init', '--initial-branch=main', seed]);
        await writeFile(join(seed, 'README.md'), 'one commit\n');
        await git(['add', 'README.md'], seed);
        await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], seed);
        await git(['remote', 'add', 'origin', bare], seed);
        await git(['push', 'origin', 'main'], seed);
        let fetchFailures = GIT_FETCH_ATTEMPTS - 1;
        const fetchEnvs: NodeJS.ProcessEnv[] = [];
        const workspace = createWorkspaceManager({ originUrlBase: originBase, exec: async (file, args, options) => {
            if (args[0] === 'fetch') {
                fetchEnvs.push(options.env);
                if (fetchFailures-- > 0) throw Object.assign(new Error('timed out'), { stderr: 'remote: busy\nfatal: unable to access origin\n' });
            }
            return execute(file, args, options);
        } });
        const options = { home: join(dir, 'agent'), repo: 'owner/repo', taskId: 'task-12345678', handle: 'atlas' };
        expect((await workspace(options)).branch).toBe('happy/atlas/12345678-1');
        expect(fetchEnvs).toHaveLength(GIT_FETCH_ATTEMPTS);
        expect(fetchEnvs[0]).toMatchObject({ GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '20' });

        fetchFailures = GIT_FETCH_ATTEMPTS;
        await expect(workspace(options)).rejects.toThrow('Git fetch failed for owner/repo; check repository access and GitHub connection (fatal: unable to access origin)');
    });

    it.each(['../repo','owner/..', 'owner/repo;echo', 'owner/repo/extra'])('rejects unsafe repo %s', async repo => {
        await expect(createWorkspaceManager()({ home: dir, repo, taskId: 'task', handle: 'atlas' })).rejects.toThrow('Invalid');
    });
});
