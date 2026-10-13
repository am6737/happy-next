import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareTeammateIsolation } from './isolation';
import { githubGitEnv } from './workspace';

const execute = promisify(execFile);
const run = (file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
    execute(file, args, { ...options, timeout: 10000 }).then(({ stdout }) => ({ code: 0, stdout, stderr: '' }),
        (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));

describe('teammate isolation', () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'happy-isolation-')); });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    it('blocks owner-only gh commands and passes everything else to the next gh on PATH', async () => {
        const { env } = await prepareTeammateIsolation(join(dir, 'agent'), 'claude');
        expect(env).toMatchObject({ DISABLE_AUTO_COMPACT: '', DISABLE_COMPACT: '' });
        const realBin = join(dir, 'real');
        await mkdir(realBin);
        await writeFile(join(realBin, 'gh'), '#!/bin/sh\necho "real gh $*"\n');
        await chmod(join(realBin, 'gh'), 0o755);
        const shellEnv = { ...process.env, PATH: [env.PATH.split(delimiter)[0], realBin, '/usr/bin', '/bin'].join(delimiter) };
        const gh = (...args: string[]) => run('sh', ['-c', 'gh "$@"', 'gh', ...args], { env: shellEnv });
        expect(await gh('pr', 'create', '--draft')).toMatchObject({ code: 0, stdout: 'real gh pr create --draft\n' });
        for (const args of [['pr', 'merge', '7'], ['pr', 'ready'], ['repo', 'delete', 'o/r'], ['api', '-X', 'PUT', 'repos/o/r/pulls/7/merge'],
            ['api', 'graphql', '-f', 'query=mutation { markPullRequestReadyForReview(input: {}) { clientMutationId } }']]) {
            const result = await gh(...args);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain('reserved for the owner');
        }
    });

    it('rejects pushes to the default branch and still runs the repository hook with the push refs', async () => {
        const { hooksPath } = await prepareTeammateIsolation(join(dir, 'agent'), 'claude');
        const bare = join(dir, 'origin.git');
        const clone = join(dir, 'clone');
        const git = (args: string[], cwd?: string) => run('git', args, { cwd, env: { ...process.env, ...githubGitEnv(undefined, [['core.hooksPath', hooksPath]]) } });
        await git(['init', '--bare', '--initial-branch=trunk', bare]);
        await git(['clone', bare, clone]);
        await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init'], clone);
        // An empty origin has no HEAD ref yet; seed it the way a real clone of an existing repo would have it.
        expect((await run('git', ['push', 'origin', 'HEAD:trunk'], { cwd: clone })).code).toBe(0);
        await git(['remote', 'set-head', 'origin', 'trunk'], clone);
        await writeFile(join(clone, '.git', 'hooks', 'pre-push'), '#!/bin/sh\ncat > "$(git rev-parse --git-dir)/pushed"\n');
        await chmod(join(clone, '.git', 'hooks', 'pre-push'), 0o755);

        await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'change'], clone);
        const blocked = await git(['push', 'origin', 'HEAD:trunk'], clone);
        expect(blocked.code).not.toBe(0);
        expect(blocked.stderr).toContain('pushing to the default branch is reserved for the owner');
        expect(await git(['push', 'origin', 'HEAD:refs/heads/happy/atlas/1'], clone)).toMatchObject({ code: 0 });
        expect(await readFile(join(clone, '.git', 'pushed'), 'utf8')).toMatch(/^HEAD [0-9a-f]{40} refs\/heads\/happy\/atlas\/1 0{40}\n$/);
    });

    it('gives Codex its own home with the owner model setup but not their projects, servers or UI state', async () => {
        const userHome = join(dir, 'user-codex');
        await mkdir(userHome);
        await writeFile(join(userHome, 'auth.json'), '{}');
        await writeFile(join(userHome, 'config.toml'), [
            'model_provider = "api"', 'model_auto_compact_token_limit = 1000', 'model_auto_compact_token_limit_scope = "global"', 'allow_login_shell = true', '',
            '[model_providers.api]', 'base_url = "https://example.test/v1"', 'model_auto_compact_token_limit = 2000', 'model_auto_compact_token_limit_scope = "model"', '',
            '[projects."/home/owner/secret"]', 'trust_level = "trusted"', '',
            '[mcp_servers.docs]', 'url = "https://example.test/mcp"', '',
            '[tui.model_availability_nux]', 'seen = true', '',
            '[features]', 'web_search = true',
        ].join('\n'));
        const home = join(dir, 'agent');
        const isolation = await prepareTeammateIsolation(home, 'codex', userHome);
        const codexHome = join(home, 'state', 'codex');
        expect(isolation).toMatchObject({ codexHome, env: { CODEX_HOME: codexHome } });
        expect(await readlink(join(codexHome, 'auth.json'))).toBe(join(userHome, 'auth.json'));
        expect(await readFile(join(codexHome, 'config.toml'), 'utf8')).toBe([
            'allow_login_shell = false', 'model_provider = "api"', '',
            '[model_providers.api]', 'base_url = "https://example.test/v1"', '',
            '[features]', 'web_search = true',
        ].join('\n'));
        expect(await readFile(join(codexHome, 'rules', 'teammate.rules'), 'utf8')).toContain('prefix_rule(pattern=["gh","pr","merge"], decision="forbidden")');
        await prepareTeammateIsolation(home, 'codex', userHome);
        expect(await readlink(join(codexHome, 'auth.json'))).toBe(join(userHome, 'auth.json'));
    });
});
