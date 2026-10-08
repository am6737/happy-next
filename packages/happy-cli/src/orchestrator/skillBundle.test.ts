import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSkillBundle, type SkillBundle } from './skillBundle';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function fixture(path = 'SKILL.md'): SkillBundle {
  const data = Buffer.from('Safe instructions\n');
  const files = [{ path, contentBase64: data.toString('base64'), sha256: sha(data) }];
  return { skillId: 'skill-1', version: 1,
    hash: sha(JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 })))), files };
}
describe('skill bundle cache', () => {
  it('installs pinned bytes once and rejects traversal, tampering, and links', () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-skill-bundle-'));
    try {
      const bundle = fixture();
      const expected = { skillId: bundle.skillId, version: bundle.version, hash: bundle.hash };
      const installed = installSkillBundle(root, bundle, expected);
      expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toBe('Safe instructions\n');
      expect(installSkillBundle(root, bundle, expected)).toBe(installed);
      const bad = fixture('../escape');
      expect(() => installSkillBundle(root, bad, { skillId: bad.skillId, version: bad.version, hash: bad.hash })).toThrow();
      expect(() => installSkillBundle(root, { ...bundle, files: [{ ...bundle.files[0], contentBase64: Buffer.from('changed').toString('base64') }] }, expected)).toThrow();
      rmSync(join(installed, 'SKILL.md'));
      symlinkSync('/etc/passwd', join(installed, 'SKILL.md'));
      expect(() => installSkillBundle(root, bundle, expected)).toThrow(/symbolic link/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
