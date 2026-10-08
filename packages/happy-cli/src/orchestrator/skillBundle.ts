import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

export type SkillBundle = { skillId: string; version: number; hash: string;
  files: { path: string; contentBase64: string; sha256: string }[] };
const MAX_FILES = 128;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
function sha(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function safePath(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !path.includes('\\') && !path.includes('\0')
    && !path.startsWith('/') && !/^[A-Za-z]:/.test(path)
    && /^[A-Za-z0-9._/-]+$/.test(path)
    && posix.normalize(path) === path && path.split('/').every((part) => part !== '.' && part !== '..' && part !== '');
}
export function installSkillBundle(root: string, bundle: SkillBundle, expected: {
  skillId: string; version: number; hash: string }): string {
  if (bundle.skillId !== expected.skillId || bundle.version !== expected.version
    || !/^[a-zA-Z0-9_-]{1,100}$/.test(expected.skillId) || !Number.isSafeInteger(expected.version) || expected.version < 1
    || bundle.hash !== expected.hash || !/^[0-9a-f]{64}$/.test(bundle.hash)
    || !Array.isArray(bundle.files) || bundle.files.length < 1 || bundle.files.length > MAX_FILES)
    throw new Error('Skill bundle identity mismatch');
  const seen = new Set<string>();
  let total = 0;
  const files = bundle.files.map((item) => {
    if (!safePath(item.path) || seen.has(item.path) || !/^[0-9a-f]{64}$/.test(item.sha256)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.contentBase64))
      throw new Error('Invalid skill file');
    seen.add(item.path);
    const bytes = Buffer.from(item.contentBase64, 'base64');
    total += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || sha(bytes) !== item.sha256)
      throw new Error('Skill file hash or size mismatch');
    if (item.path === 'SKILL.md') {
      if (!bytes.length || bytes.includes(0)) throw new Error('Skill manifest is invalid');
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    return { path: item.path, bytes, sha256: item.sha256 };
  });
  if (!seen.has('SKILL.md')) throw new Error('Skill manifest is missing');
  const canonical = JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path)));
  if (sha(Buffer.from(canonical)) !== expected.hash) throw new Error('Skill bundle hash mismatch');
  const destination = join(root, `${expected.skillId}-${expected.version}-${expected.hash}`);
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error('Skill cache is a symbolic link');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const resolvedRoot = realpathSync(destination);
  for (const item of files) {
    const target = join(destination, item.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    let parent = dirname(target);
    while (parent.startsWith(destination)) {
      if (lstatSync(parent).isSymbolicLink()) throw new Error('Skill cache contains a symbolic link');
      if (parent === destination) break;
      parent = dirname(parent);
    }
    if (!realpathSync(dirname(target)).startsWith(`${resolvedRoot}/`) && realpathSync(dirname(target)) !== resolvedRoot)
      throw new Error('Skill path escaped cache');
    try { if (lstatSync(target).isSymbolicLink()) throw new Error('Skill file is a symbolic link'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existsSync(target)) {
      if (!lstatSync(target).isFile() || sha(readFileSync(target)) !== item.sha256)
        throw new Error('Skill cache contains changed content');
    } else writeFileSync(target, item.bytes, { mode: 0o600, flag: 'wx' });
    if (sha(readFileSync(target)) !== item.sha256) throw new Error('Skill cache verification failed');
  }
  return destination;
}
