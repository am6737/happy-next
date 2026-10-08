import { execFileSync } from 'node:child_process';

// Git path bytes are identity: preserve a leading UTF-8 BOM in each NUL field.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function nulFields(value: Buffer): string[] {
  if (!value.length || value[value.length - 1] !== 0)
    throw new Error('Malformed Git NUL output');
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== 0) continue;
    fields.push(utf8.decode(value.subarray(start, index)));
    start = index + 1;
  }
  return fields;
}

function output(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd, timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}

export function changedPaths(cwd: string, base: string, commit: string): string[] {
  const result = output(cwd, ['diff', '--no-renames', '--name-only', '-z', base, commit, '--']);
  if (!result.length) return [];
  const paths = nulFields(result);
  if (paths.some((path) => !path)) throw new Error('Malformed Git diff path');
  return paths;
}

function treeEntry(cwd: string, commit: string, path: string): string | null {
  const result = output(cwd, ['ls-tree', '-z', commit, '--', `:(literal)${path}`]);
  if (!result.length) return null;
  const entries = nulFields(result);
  const exact = entries.filter((entry) => entry.slice(entry.indexOf('\t') + 1) === path);
  if (exact.length !== 1) throw new Error('Unexpected Git tree entry');
  const entry = exact[0];
  const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40,64})\t/.exec(entry);
  if (!match || (match[1] === '160000') !== (match[2] === 'commit'))
    throw new Error('Malformed Git tree entry');
  return `${match[1]} ${match[2]} ${match[3]}`;
}

export function matchingChangedEntries(sourceCwd: string, aggregateCwd: string,
  base: string, sourceCommit: string, aggregateCommit: string): boolean {
  return changedPaths(sourceCwd, base, sourceCommit).every((path) =>
    treeEntry(sourceCwd, sourceCommit, path) === treeEntry(aggregateCwd, aggregateCommit, path));
}

export function currentBranch(cwd: string): string {
  return output(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).toString('utf8').trim();
}
