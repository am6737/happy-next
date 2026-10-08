import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '@/configuration';

type Binding = { taskId: string; worktree: string };

function hasExactPrivateSession(home: string, sessionId: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  const projects = join(home, 'projects');
  if (!existsSync(projects)) return false;
  let found = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > 4 || lstatSync(directory).isSymbolicLink())
      throw new Error('SESSION_RECOVERY_REQUIRED: unsafe Claude session directory');
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('SESSION_RECOVERY_REQUIRED: unsafe Claude session entry');
      if (stat.isDirectory()) visit(path, depth + 1);
      else if (stat.isFile() && name === `${sessionId}.jsonl`) found++;
    }
  };
  visit(projects, 0);
  return found === 1;
}

export function prepareIsolatedClaudeHome(taskId: string, worktree: string,
  resumeSessionId?: string): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(taskId) || !worktree.startsWith('/'))
    throw new Error('SESSION_RECOVERY_REQUIRED: invalid Claude task identity');
  const canonical = realpathSync(worktree);
  if (canonical !== worktree || !lstatSync(worktree).isDirectory())
    throw new Error('SESSION_RECOVERY_REQUIRED: Claude worktree changed');
  const root = join(configuration.happyHomeDir, 'orchestrator-claude');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const home = join(root, createHash('sha256').update(taskId).digest('hex'));
  if (existsSync(home) && (lstatSync(home).isSymbolicLink() || !lstatSync(home).isDirectory()))
    throw new Error('SESSION_RECOVERY_REQUIRED: Claude home changed');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const marker = join(home, 'binding.json');
  let binding: Binding;
  if (existsSync(marker)) {
    if (lstatSync(marker).isSymbolicLink() || !lstatSync(marker).isFile())
      throw new Error('SESSION_RECOVERY_REQUIRED: Claude binding changed');
    binding = JSON.parse(readFileSync(marker, 'utf8')) as Binding;
    if (binding.taskId !== taskId || binding.worktree !== worktree)
      throw new Error('SESSION_RECOVERY_REQUIRED: Claude binding changed');
  } else {
    if (resumeSessionId) throw new Error('SESSION_RECOVERY_REQUIRED: Claude private session unavailable');
    binding = { taskId, worktree };
    writeFileSync(marker, JSON.stringify(binding), { mode: 0o600, flag: 'wx' });
  }
  if (resumeSessionId) {
    if (!hasExactPrivateSession(home, resumeSessionId))
      throw new Error('SESSION_RECOVERY_REQUIRED: exact private Claude session unavailable');
  }
  return home;
}
