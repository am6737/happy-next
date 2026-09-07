import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readCodexResumeDirectory, resolveCodexResumeDirectory } from './resumeDirectory';
import { parseCodexCliInvocation } from './cli';
const current = join(tmpdir(), 'current');
const session = join(tmpdir(), 'session');
function dependencies() {
  return {
    readDirectory: vi.fn(async () => session as string | null),
    readPreference: vi.fn(async (): Promise<'session' | 'current' | undefined> => undefined),
    savePreference: vi.fn(async (_mode: 'session' | 'current') => {}),
    isInteractive: () => true,
    prompt: vi.fn(async (): Promise<{ mode: 'session' | 'current'; remember: boolean } | null> => ({ mode: 'session', remember: false })),
    normalize: vi.fn(async (path: string) => path),
    validate: vi.fn(async (_path: string) => {}),
  };
}
describe('Codex resume directory', () => {
  it('reads latest turn_context cwd and handles malformed or missing metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happy-resume-cwd-'));
    try {
      const file = join(dir, 'rollout.jsonl');
      const record = (type: string, cwd: string) => JSON.stringify({ type, payload: { cwd } });
      await writeFile(file, [record('session_meta', current), record('turn_context', session), 'broken JSON', record('session_meta', current), record('turn_context', 'relative'), 'null'].join('\n'));
      expect(await readCodexResumeDirectory(file)).toBe(session);
      await writeFile(file, record('session_meta', current));
      expect(await readCodexResumeDirectory(file)).toBe(current);
      await writeFile(file, '');
      expect(await readCodexResumeDirectory(file)).toBeNull();
      await expect(readCodexResumeDirectory(join(dir, 'missing'))).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it.each(['session', 'current'] as const)('honors one-time %s selection', async mode => {
    const deps = dependencies();
    deps.prompt.mockResolvedValue({ mode, remember: false });
    expect(await resolveCodexResumeDirectory('file', current, undefined, deps)).toBe(mode === 'session' ? session : current);
    expect(deps.prompt).toHaveBeenCalledWith(session, current);
    expect(deps.savePreference).not.toHaveBeenCalled();
  });
  it.each(['session', 'current'] as const)('saves always-%s selection', async mode => {
    const deps = dependencies();
    deps.prompt.mockResolvedValue({ mode, remember: true });
    await resolveCodexResumeDirectory('file', current, undefined, deps);
    expect(deps.savePreference).toHaveBeenCalledWith(mode);
  });
  it.each(['session', 'current'] as const)('honors saved %s preference', async mode => {
    const deps = dependencies();
    deps.readPreference.mockResolvedValue(mode);
    expect(await resolveCodexResumeDirectory('file', current, undefined, deps)).toBe(mode === 'session' ? session : current);
    expect(deps.prompt).not.toHaveBeenCalled();
  });
  it('explicit current overrides saved session preference without changing it', async () => {
    const deps = dependencies();
    deps.readPreference.mockResolvedValue('session');
    expect(await resolveCodexResumeDirectory('file', current, 'current', deps)).toBe(current);
    expect(deps.readDirectory).not.toHaveBeenCalled();
    expect(deps.savePreference).not.toHaveBeenCalled();
  });
  it('ask overrides saved preference', async () => {
    const deps = dependencies();
    deps.readPreference.mockResolvedValue('current');
    await resolveCodexResumeDirectory('file', current, 'ask', deps);
    expect(deps.prompt).toHaveBeenCalled();
  });
  it('does not prompt for equivalent paths including symlink aliases', async () => {
    const deps = dependencies();
    deps.normalize.mockResolvedValue(session);
    await resolveCodexResumeDirectory('file', current, undefined, deps);
    expect(deps.prompt).not.toHaveBeenCalled();
  });
  it('requires explicit intent in non-interactive mode', async () => {
    const deps = dependencies();
    deps.isInteractive = () => false;
    await expect(resolveCodexResumeDirectory('file', current, undefined, deps)).rejects.toThrow('--resume-cwd');
    expect(await resolveCodexResumeDirectory('file', current, 'session', deps)).toBe(session);
    expect(await resolveCodexResumeDirectory('file', current, 'current', deps)).toBe(current);
  });
  it('cancels without saving', async () => {
    const deps = dependencies();
    deps.prompt.mockResolvedValue(null);
    await expect(resolveCodexResumeDirectory('file', current, undefined, deps)).rejects.toMatchObject({ name: 'CodexCliSelectionCancelledError' });
    expect(deps.savePreference).not.toHaveBeenCalled();
  });
  it('does not save preference or silently fall back for missing chosen directory', async () => {
    const deps = dependencies();
    deps.prompt.mockResolvedValue({ mode: 'session', remember: true });
    deps.validate.mockRejectedValue(new Error('missing'));
    await expect(resolveCodexResumeDirectory('file', current, undefined, deps)).rejects.toThrow('Cannot use resume working directory');
    expect(deps.savePreference).not.toHaveBeenCalled();
  });
  it('uses current cwd for missing metadata unless session cwd is required', async () => {
    const deps = dependencies();
    deps.readDirectory.mockResolvedValue(null);
    expect(await resolveCodexResumeDirectory('file', current, undefined, deps)).toBe(current);
    await expect(resolveCodexResumeDirectory('file', current, 'session', deps)).rejects.toThrow('No working directory');
  });
  it.each(['session', 'current', 'ask'])('parses --resume-cwd %s', mode => {
    expect(parseCodexCliInvocation(['resume', '--resume-cwd', mode, 'id', '--all'])).toMatchObject({ sessionId: 'id', resumeCwd: mode, includeAllDirectories: true });
  });
  it.each([{ values: [] }, { values: ['wrong'] }])('rejects invalid option $values', ({ values }) => {
    expect(() => parseCodexCliInvocation(['resume', '--resume-cwd', ...values])).toThrow('--resume-cwd must be followed');
  });
});
