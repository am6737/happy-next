import { createHash } from 'node:crypto';
import { link, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function inspectUnsupportedArchives(roots: string[]): Promise<{ records: number; bytes: number }> {
  let records = 0;
  let bytes = 0;
  for (const root of roots) {
    const directory = join(root, 'unsupported');
    let files: string[];
    try { files = await readdir(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files) {
      const entry = await lstat(join(directory, file));
      if (!entry.isFile()) throw new Error('Unsupported telemetry archive contains non-file entry');
      bytes += entry.size;
      if (!file.endsWith('.reason')) records++;
    }
  }
  return { records, bytes };
}

export async function requireUnsupportedArchiveCapacity(roots: string[]): Promise<void> {
  const archive = await inspectUnsupportedArchives(roots);
  if (archive.records >= 1_000 || archive.bytes >= 64 * 1024 * 1024)
    throw new Error('Unsupported telemetry archive capacity reached; administrator export and resolution required');
}

export async function archiveUnsupported(root: string, file: string): Promise<void> {
  const destination = join(root, 'unsupported');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const destinationStat = await lstat(destination);
  if (!destinationStat.isDirectory() || (destinationStat.mode & 0o077) !== 0)
    throw new Error('Unsupported telemetry archive directory is unsafe');
  const source = join(root, file);
  const target = join(destination, file);
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || (sourceStat.mode & 0o077) !== 0)
    throw new Error('Unsupported telemetry source is unsafe');
  const contents = await readFile(source);
  const digest = createHash('sha256').update(contents).digest('hex');
  const metadata = JSON.stringify({ reason: 'TELEMETRY_ENDPOINT_UNSUPPORTED', sha256: digest,
    bytes: contents.length });
  const capacity = await inspectUnsupportedArchives([root]);
  if (capacity.records >= 1_000 || capacity.bytes + contents.length + Buffer.byteLength(metadata) >= 64 * 1024 * 1024)
    throw new Error('Unsupported telemetry archive capacity reached; administrator export and resolution required');
  const reason = `${target}.reason`;
  try { await writeFile(reason, metadata, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(reason, 'utf8') !== metadata)
      throw new Error('Unsupported telemetry archive identity changed');
  }
  try { await link(source, target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
      || !(await lstat(target)).isFile()
      || createHash('sha256').update(await readFile(target)).digest('hex') !== digest)
      throw new Error('Unsupported telemetry archive identity changed');
  }
  await rm(source);
}
