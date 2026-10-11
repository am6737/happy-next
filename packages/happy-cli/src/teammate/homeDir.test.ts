import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendDailyLog, commitTeammateHome, ensureTeammateHome, generateSessionKeyFile, isHeartbeatChecklistEmpty, readThreadsState, teammateHomeDir, writeSessionKeyFile, writeThreadsState } from './homeDir';
import { makeTeammate } from './testFixtures';

const { home } = vi.hoisted(() => ({ home: { path: '' } }));
vi.mock('@/configuration', () => ({
    configuration: { get happyHomeDir() { return home.path; } },
}));

const hasGit = spawnSync('git', ['--version']).status === 0;

describe('teammate home', () => {
    beforeEach(async () => {
        home.path = await mkdtemp(join(tmpdir(), 'happy-teammate-home-'));
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(home.path, { recursive: true, force: true });
    });

    it('resolves the configured home and creates the complete layout', async () => {
        const teammate = makeTeammate();
        const result = await ensureTeammateHome(teammate);
        expect(result.dir).toBe(join(home.path, 'agents', teammate.id));
        expect(teammateHomeDir(teammate.id)).toBe(result.dir);
        expect(result.created).toBe(true);
        for (const file of ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md', '.gitignore']) {
            expect((await stat(join(result.dir, file))).isFile()).toBe(true);
        }
        for (const directory of ['memory', 'skills', 'state/keys', 'workspaces']) {
            expect((await stat(join(result.dir, directory))).isDirectory()).toBe(true);
        }
        expect(await readFile(join(result.dir, '.gitignore'), 'utf8')).toBe('state/\nworkspaces/\n.claude/skills/\n.agents/skills/\n');
    });

    it('treats the default heartbeat checklist and empty list items as empty', async () => {
        const { dir } = await ensureTeammateHome(makeTeammate());
        expect(isHeartbeatChecklistEmpty(await readFile(join(dir, 'HEARTBEAT.md'), 'utf8'))).toBe(true);
        expect(isHeartbeatChecklistEmpty('# Checks\n<!-- note -->\n-\n- [ ]\n')).toBe(true);
        expect(isHeartbeatChecklistEmpty('# Checks\n- [ ] Review PRs')).toBe(false);
        await writeFile(join(dir, 'HEARTBEAT.md'), '- Check builds');
        await ensureTeammateHome(makeTeammate());
        expect(await readFile(join(dir, 'HEARTBEAT.md'), 'utf8')).toBe('- Check builds');
    });

    it.skipIf(!hasGit)('commits dirty home changes with teammate identity and skips clean repos', async () => {
        const { dir } = await ensureTeammateHome(makeTeammate());
        expect(await commitTeammateHome(dir, 'nothing')).toEqual({ committed: false });
        await writeFile(join(dir, 'MEMORY.md'), 'Durable fact');
        const result = await commitTeammateHome(dir, 'Remember fact');
        expect(result).toMatchObject({ committed: true, commit: expect.stringMatching(/^[a-f0-9]{40}$/) });
        expect(spawnSync('git', ['log', '-1', '--format=%an <%ae>|%s'], { cwd: dir, encoding: 'utf8' }).stdout.trim()).toBe('Atlas <atlas@agents.happy.local>|Remember fact');
        expect(await commitTeammateHome(dir, 'nothing')).toEqual({ committed: false });
    });

    it('preserves USER and MEMORY and rerenders all managed profile files', async () => {
        const teammate = makeTeammate();
        const { dir } = await ensureTeammateHome(teammate);
        await writeFile(join(dir, 'USER.md'), 'Owner prefers Chinese.');
        await writeFile(join(dir, 'MEMORY.md'), 'A durable private learning.');
        const result = await ensureTeammateHome(makeTeammate({
            name: 'Nova', instructions: 'Explain tradeoffs.', role: 'Reviewer', canSelfAssign: true,
        }));
        expect(result.created).toBe(false);
        expect(await readFile(join(dir, 'USER.md'), 'utf8')).toBe('Owner prefers Chinese.');
        expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toBe('A durable private learning.');
        expect(await readFile(join(dir, 'SOUL.md'), 'utf8')).toContain('Explain tradeoffs.');
        expect(await readFile(join(dir, 'SOUL.md'), 'utf8')).toContain('Reviewer');
        expect(await readFile(join(dir, 'IDENTITY.md'), 'utf8')).toContain('Nova');
        expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toContain('— 🤖 Nova (Happy Agent)');
        expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toContain('canSelfAssign=true');
    });

    it.skipIf(!hasGit)('commits changes with a local identity and avoids empty commits', async () => {
        const teammate = makeTeammate();
        const result = await ensureTeammateHome(teammate);
        const git = (args: string[]) => {
            const output = spawnSync('git', args, { cwd: result.dir, encoding: 'utf8' });
            expect(output.status).toBe(0);
            return output.stdout.trim();
        };
        expect(result.committed).toBe(true);
        expect(git(['log', '-1', '--format=%s'])).toBe('chore: sync profile');
        expect(git(['log', '-1', '--format=%an <%ae>'])).toBe('Atlas <atlas@agents.happy.local>');
        expect(git(['config', '--local', 'user.name'])).toBe('Atlas');
        expect(git(['config', '--local', 'user.email'])).toBe('atlas@agents.happy.local');
        const firstCommit = git(['rev-parse', 'HEAD']);
        expect((await ensureTeammateHome(teammate)).committed).toBe(false);
        expect(git(['rev-parse', 'HEAD'])).toBe(firstCommit);
        await generateSessionKeyFile(result.dir, 'private-key');
        await writeThreadsState(result.dir, { thread: { currentSessionId: 'session-1' } });
        await writeFile(join(result.dir, 'workspaces', 'private.txt'), 'workspace');
        expect((await ensureTeammateHome(teammate)).committed).toBe(false);
        expect(git(['ls-files'])).not.toMatch(/state\/|workspaces\//);
        await appendDailyLog(result.dir, { text: 'A learning' });
        expect((await ensureTeammateHome(teammate)).committed).toBe(true);
        expect(git(['rev-list', '--count', 'HEAD'])).toBe('2');
    });

    it.skipIf(!hasGit)('initializes its own repository inside an ancestor repository', async () => {
        expect(spawnSync('git', ['init', home.path]).status).toBe(0);
        const { dir } = await ensureTeammateHome(makeTeammate());
        expect((await stat(join(dir, '.git'))).isDirectory()).toBe(true);
        expect(spawnSync('git', ['status', '--porcelain'], { cwd: home.path, encoding: 'utf8' }).stdout).toContain('?? agents/');
    });

    it('still creates the profile when git is unavailable', async () => {
        vi.stubEnv('PATH', home.path);
        const result = await ensureTeammateHome(makeTeammate());
        expect(result).toMatchObject({ created: true, committed: false });
        expect(await readFile(join(result.dir, 'AGENTS.md'), 'utf8')).toContain('Operating rules');
    });

    it('allows an explicit isolated directory', async () => {
        const dir = join(home.path, 'override');
        expect((await ensureTeammateHome(makeTeammate(), { dir })).dir).toBe(dir);
    });

    it('appends daily bullets using local date/time with run and session references', async () => {
        const at = new Date(2026, 0, 2, 3, 4);
        await appendDailyLog(home.path, { text: 'Verified the fix.', runId: 'run-1', sessionId: 'session-1', at });
        await appendDailyLog(home.path, { text: 'Follow-up.', at });
        expect(await readFile(join(home.path, 'memory', '2026-01-02.md'), 'utf8')).toBe(
            '# 2026-01-02\n\n- 03:04 Verified the fix. (run run-1, session session-1)\n- 03:04 Follow-up.\n',
        );
    });

    it('uses the local calendar day even when UTC is already the next day', async () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        await appendDailyLog(home.path, { text: 'Late afternoon.', at: new Date('2026-01-02T01:04:00Z') });
        expect(await readFile(join(home.path, 'memory', '2026-01-01.md'), 'utf8')).toBe('# 2026-01-01\n\n- 17:04 Late afternoon.\n');
    });

    it('handles missing, malformed JSON, and invalid thread state shapes', async () => {
        expect(await readThreadsState(home.path)).toEqual({});
        await mkdir(join(home.path, 'state'));
        for (const corrupt of ['{broken', 'null', '[]', '{"thread":{"lastActiveAt":"yesterday"}}']) {
            await writeFile(join(home.path, 'state', 'threads.json'), corrupt);
            expect(await readThreadsState(home.path)).toEqual({});
        }
    });

    it('writes thread state atomically and replaces the previous snapshot', async () => {
        const state = { thread: { providerSessionId: 'provider-1', currentSessionId: 'session-1', lastActiveAt: 123 } };
        await writeThreadsState(home.path, state);
        expect(await readThreadsState(home.path)).toEqual(state);
        await writeThreadsState(home.path, { other: {} });
        expect(await readThreadsState(home.path)).toEqual({ other: {} });
        expect(await readdir(join(home.path, 'state'))).toEqual(['threads.json']);
    });

    it('writes a base64 32-byte key to an absolute path with private permissions', async () => {
        const key = new Uint8Array(32).fill(42);
        const path = await writeSessionKeyFile(home.path, 'session-1', key);
        expect(isAbsolute(path)).toBe(true);
        expect(path).toBe(join(home.path, 'state', 'keys', 'session-1.key'));
        expect(await readFile(path, 'utf8')).toBe(Buffer.from(key).toString('base64'));
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(join(home.path, 'state'))).mode & 0o777).toBe(0o700);
        expect((await stat(join(home.path, 'state', 'keys'))).mode & 0o777).toBe(0o700);
        await chmod(path, 0o644);
        await writeSessionKeyFile(home.path, 'session-1', key);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    });

    it('generates independent random keys and persists their returned bytes', async () => {
        const first = await generateSessionKeyFile(home.path, 'first');
        const second = await generateSessionKeyFile(home.path, 'second');
        expect(first.key).toHaveLength(32);
        expect(first.key).not.toEqual(second.key);
        expect(await readFile(first.path, 'utf8')).toBe(Buffer.from(first.key).toString('base64'));
    });

    it('rejects path traversal and invalid key lengths', async () => {
        expect(() => teammateHomeDir('../escape')).toThrow('IDs');
        await expect(writeSessionKeyFile(home.path, '../escape', new Uint8Array(32))).rejects.toThrow('IDs');
        await expect(writeSessionKeyFile(home.path, 'short', new Uint8Array(31))).rejects.toThrow('32 bytes');
    });
});
