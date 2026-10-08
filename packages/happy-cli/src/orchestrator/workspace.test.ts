import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitExecutionWorkspace, prepareExecutionWorkspace, previewExecutionWorkspaceGc, rememberWorkspaceSession } from './workspace';
import { acquireFileLock } from './fileLock';

describe('execution workspace', () => {
  it('releases the kernel execution lease after owner crash', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-lock-crash-'));
    const path = join(directory, 'execution.lock');
    try {
      const script = `import { acquireFileLock } from './src/orchestrator/fileLock.ts'; await acquireFileLock(${JSON.stringify(path)}); console.log('READY'); setInterval(() => {}, 1000);`;
      const owner = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd() });
      await new Promise<void>((resolve, reject) => {
        owner.stdout.on('data', (chunk) => { if (chunk.toString().includes('READY')) resolve(); });
        owner.once('error', reject);
        owner.once('exit', () => reject(new Error('Owner exited before acquiring lease')));
      });
      await expect(acquireFileLock(path)).rejects.toThrow('unavailable');
      owner.kill('SIGKILL');
      await new Promise((resolve) => owner.once('exit', resolve));
      const recovered = await acquireFileLock(path, 2);
      await recovered.release();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('recovers a recorded branch and stale Git worktree registration', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-workspace-recover-'));
    const repo = join(directory, 'repo');
    const root = join(directory, 'workspaces');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    try {
      execFileSync('git', ['init', repo], { stdio: 'pipe' });
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      writeFileSync(join(repo, 'file.txt'), 'committed');
      git(['add', '.']); git(['commit', '-m', 'initial']);
      const first = await prepareExecutionWorkspace(root, repo, 'task-recover');
      rmSync(first.worktreePath, { recursive: true });
      expect(await prepareExecutionWorkspace(root, repo, 'task-recover')).toEqual(first);
      git(['worktree', 'remove', '--force', first.worktreePath]);
      expect(await prepareExecutionWorkspace(root, repo, 'task-recover')).toEqual(first);
      writeFileSync(join(first.worktreePath, 'exact.txt'), 'exact\n');
      const commit = commitExecutionWorkspace(first);
      expect(commit).not.toBe(first.baseCommit);
      expect(execFileSync('git', ['show', 'HEAD:exact.txt'], { cwd: first.worktreePath }).toString()).toBe('exact\n');
      expect(git(['rev-parse', 'HEAD']).toString().trim()).toBe(first.baseCommit);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('serializes two real processes creating the same task worktree', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-workspace-race-'));
    const repo = join(directory, 'repo');
    const root = join(directory, 'workspaces');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    try {
      execFileSync('git', ['init', repo], { stdio: 'pipe' });
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      writeFileSync(join(repo, 'file.txt'), 'committed');
      git(['add', '.']);
      git(['commit', '-m', 'initial']);
      const script = `import { prepareExecutionWorkspace } from './src/orchestrator/workspace.ts'; console.log(JSON.stringify(await prepareExecutionWorkspace(${JSON.stringify(root)}, ${JSON.stringify(repo)}, 'race-task')))`;
      const run = () => new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd() });
        let output = ''; let errors = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { errors += chunk; });
        child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
      });
      const [first, second] = await Promise.all([run(), run()]);
      expect(JSON.parse(first)).toEqual(JSON.parse(second));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('isolates real Git checkouts, preserves dirty source files, and resumes the same branch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-workspace-test-'));
    const repo = join(directory, 'repo');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    try {
      execFileSync('git', ['init', repo], { stdio: 'pipe' });
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      writeFileSync(join(repo, 'file.txt'), 'committed');
      git(['add', '.']);
      git(['commit', '-m', 'initial']);
      writeFileSync(join(repo, 'file.txt'), 'user changes');
      const root = join(directory, 'workspaces');
      const first = await prepareExecutionWorkspace(root, repo, 'task-a');
      const second = await prepareExecutionWorkspace(root, repo, 'task-b');
      expect(first.worktreePath).not.toBe(second.worktreePath);
      expect(readFileSync(join(first.worktreePath, 'file.txt'), 'utf8')).toBe('committed');
      expect(readFileSync(join(repo, 'file.txt'), 'utf8')).toBe('user changes');
      writeFileSync(join(first.worktreePath, 'file.txt'), 'agent changes');
      expect(await previewExecutionWorkspaceGc(root, new Set(['task-a', 'task-b']), 0)).toEqual([second]);
      const held = await acquireFileLock(`${second.worktreePath}.execution.lock`);
      expect(await previewExecutionWorkspaceGc(root, new Set(['task-b']), 0)).toEqual([]);
      await held.release();
      expect(await prepareExecutionWorkspace(root, repo, 'task-a')).toEqual(first);
      await rememberWorkspaceSession(root, 'session-a', first);
      expect(await prepareExecutionWorkspace(root, repo, 'task-a', 'session-a')).toEqual(first);
      await expect(prepareExecutionWorkspace(root, repo, 'followup', 'session-a')).rejects.toThrow('identity changed');
      await expect(prepareExecutionWorkspace(root, repo, 'followup', 'missing-session')).rejects.toThrow('No workspace');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
