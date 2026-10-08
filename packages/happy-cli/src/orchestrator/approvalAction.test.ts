import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeApprovalAction } from './approvalAction';

it('binds a reviewable command to the exact started item and rejects opaque actions', () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-action-'));
  const cwd = join(root, 'worktree');
  const other = join(root, 'other');
  mkdirSync(cwd); mkdirSync(other);
  try {
  const session = 'session-1234';
  const item = 'item-1234';
  const approved = normalizeApprovalAction(session, item, 'CodexBash', {
    command: ['printf approved > result.txt'], startedCommand: 'printf approved > result.txt',
    cwd, startedCwd: cwd }, cwd);
  expect(approved?.actionType).toBe('shell');
  expect(approved?.summary).toContain('printf approved > result.txt');
  const taskPath = normalizeApprovalAction(session, 'task-path-1234', 'CodexBash', {
    command: [`printf approved > ${cwd}/result.txt`],
    startedCommand: `printf approved > ${cwd}/result.txt`, cwd, startedCwd: cwd }, cwd);
  expect(taskPath?.summary).toContain('<task-worktree>/result.txt');
  expect(taskPath?.summary).not.toContain(cwd);
  const bashAction = normalizeApprovalAction(session, 'bash-command-1234', 'CodexBash', {
    command: ['/bin/bash -lc "printf approved > result.txt"'],
    startedCommand: '/bin/bash -lc "printf approved > result.txt"', cwd, startedCwd: cwd }, cwd);
  expect(bashAction?.summary).toContain('<system-bash>');
  expect(normalizeApprovalAction(session, 'other-path-1234', 'CodexBash', {
    command: [`printf approved > ${other}/result.txt`],
    startedCommand: `printf approved > ${other}/result.txt`, cwd, startedCwd: cwd }, cwd)).toBeNull();
  const changedCwd = normalizeApprovalAction(session, item, 'CodexBash', {
    command: ['printf approved > result.txt'], startedCommand: 'printf approved > result.txt',
    cwd: other, startedCwd: other });
  expect(changedCwd?.actionHash).not.toBe(approved?.actionHash);
  expect(normalizeApprovalAction(session, item, 'CodexBash', {
    command: ['printf approved > result.txt'], startedCommand: 'printf approved > result.txt',
    cwd: other, startedCwd: other }, cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'CodexBash', {
    command: ['printf changed > result.txt'], startedCommand: 'printf approved > result.txt', cwd, startedCwd: cwd }, cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'CodexBash', {
    command: ['env'], startedCommand: 'env', kind: 'network', cwd, startedCwd: cwd }, cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'CodexBash', {
    command: ['echo token=secret'], startedCommand: 'echo token=secret', cwd, startedCwd: cwd }, cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'CodexPatch', { changes: [{
    path: 'result.txt', kind: { type: 'modify' } }] })).toBeNull();
  const patch = (path: string) => ({ changes: [{ path, kind: { type: 'update' },
    diff: '@@ -1 +1 @@\n-old\n+new' }] });
  writeFileSync(join(cwd, 'result.txt'), 'old\n');
  const local = normalizeApprovalAction(session, item, 'CodexPatch', patch('result.txt'), cwd);
  expect(local?.actionType).toBe('file_change');
  expect(normalizeApprovalAction(session, item, 'CodexPatch', patch('result.txt'), other)?.actionHash)
    .not.toBe(local?.actionHash);
  expect(normalizeApprovalAction(session, item, 'CodexPatch', patch('new/deep.txt'), cwd)).not.toBeNull();
  symlinkSync(other, join(cwd, 'outside'));
  symlinkSync(join(other, 'result.txt'), join(cwd, 'linked-file'));
  expect(normalizeApprovalAction(session, item, 'CodexPatch', patch('outside/result.txt'), cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'CodexPatch', patch('linked-file'), cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'CodexPatch', {
    ...patch('result.txt'), additionalPermissions: { fileSystem: 'all' } }, cwd)).toBeNull();
  expect(normalizeApprovalAction(session, item, 'unknown_tool', {})).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
