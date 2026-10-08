import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export type ApprovalAction = { operationId: string; actionType: 'shell' | 'file_change';
  actionHash: string; summary: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function reviewable(value: string, multiline = false): boolean {
  return Buffer.byteLength(value, 'utf8') <= 1_200
    && !(multiline ? /[\x00-\x08\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)
    && !/(?:authorization|bearer|password|passwd|secret|token|api[_-]?key|private[_-]?key|\b(?:sk|rk)-[a-z0-9_-]+)/i.test(value)
    && !/(?:^|[\s'"=])(?:\/|~\/|\.\.\/)/.test(value);
}

function displayCommand(command: string, cwd: string): string {
  const displayed = command.replaceAll(cwd, (match, offset: number) => {
    const next = command[offset + match.length];
    return next === undefined || /[\s/'";|&)]/.test(next) ? '<task-worktree>' : match;
  });
  return displayed.replace(/(^|[\s'"=])\/bin\/bash(?=$|[\s'";|&])/g, '$1<system-bash>');
}

function patchTarget(root: string, path: string): { target: string; type: string } | null {
  const target = join(root, path);
  if (relative(root, target).startsWith(`..${sep}`) || target === root) return null;
  let current = root;
  let missing = false;
  let type = 'new';
  for (const part of path.split('/')) {
    if (!part || part === '.') return null;
    current = join(current, part);
    if (missing) continue;
    try {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink()) return null;
      if (current === target) {
        if (!entry.isFile() || entry.nlink !== 1) return null;
        type = 'file';
      } else if (!entry.isDirectory()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      missing = true;
    }
  }
  return { target, type };
}

export function normalizeApprovalAction(sessionId: string, callId: string,
  toolName: string, args: Record<string, unknown>, trustedCwd?: string): ApprovalAction | null {
  if (!/^[a-zA-Z0-9-]{8,256}$/.test(sessionId) || !callId || callId.length > 256) return null;
  const operationId = digest(`${sessionId}\0${callId}`);
  if (toolName === 'CodexBash') {
    if (typeof args.cwd !== 'string' || !isAbsolute(args.cwd) || !args.cwd
      || (args.startedCwd !== undefined && args.startedCwd !== args.cwd)) return null;
    let cwd: string;
    try {
      cwd = realpathSync(args.cwd);
      if (trustedCwd && cwd !== realpathSync(trustedCwd)) return null;
    } catch { return null; }
    if (args.startedCwd !== undefined && args.startedCwd !== cwd) return null;
    const command = Array.isArray(args.command) && args.command.length === 1
      ? args.command[0] : args.command;
    const displayed = typeof command === 'string' ? displayCommand(command, cwd) : '';
    if (typeof command !== 'string' || !command.trim() || !reviewable(displayed)
      || typeof args.startedCommand !== 'string' || args.startedCommand !== command
      || args.kind === 'network' || args.grantRoot || args.additionalPermissions) return null;
    return { operationId, actionType: 'shell',
      actionHash: digest(JSON.stringify({ type: 'shell', cwd, command })),
      summary: `Shell command starting in task worktree (effects may extend outside it): ${displayed}` };
  }
  if (toolName === 'CodexPatch') {
    if (!Array.isArray(args.changes) || args.changes.length < 1 || args.changes.length > 16
      || args.grantRoot || args.additionalPermissions || !trustedCwd) return null;
    if (Object.keys(args).some((key) => !['changes', 'reason', 'grantRoot', 'additionalPermissions',
      'cwd', 'startedCwd'].includes(key))) return null;
    let cwd: string;
    try { cwd = realpathSync(trustedCwd); if (!lstatSync(cwd).isDirectory()) return null; }
    catch { return null; }
    if ((args.cwd !== undefined && args.cwd !== cwd)
      || (args.startedCwd !== undefined && args.startedCwd !== cwd)) return null;
    const changes: Array<{ path: string; target: string; type: string; kind: string; diff: string }> = [];
    for (const entry of args.changes) {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as { path?: unknown; kind?: { type?: unknown }; diff?: unknown };
      if (Object.keys(item).some((key) => !['path', 'kind', 'diff'].includes(key))
        || !item.kind || Object.keys(item.kind).some((key) => key !== 'type')) return null;
      if (typeof item.path !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(item.path)
        || item.path.startsWith('/') || item.path.split('/').includes('..')
        || typeof item.kind?.type !== 'string' || !['add', 'update', 'modify', 'delete'].includes(item.kind.type)
        || typeof item.diff !== 'string' || !item.diff || !reviewable(item.diff, true)) return null;
      const target = patchTarget(cwd, item.path);
      if (!target) return null;
      changes.push({ path: item.path, ...target, kind: item.kind.type, diff: item.diff });
    }
    const summary = `File changes in task worktree: ${changes.map((change) =>
      `${change.kind} ${change.path}\n${change.diff}`).join('\n')}`;
    if (Buffer.byteLength(summary, 'utf8') > 2_000
      || new Set(changes.map((change) => change.path)).size !== changes.length) return null;
    return { operationId, actionType: 'file_change',
      actionHash: digest(JSON.stringify({ type: 'file_change', cwd, changes })), summary };
  }
  return null;
}
