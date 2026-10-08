import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type FileLock = { release: () => Promise<void>; lost: Promise<void> };

// The file is never unlinked: flock locks its inode, not its pathname.
export async function acquireFileLock(path: string, waitSeconds = 0): Promise<FileLock> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const child: ChildProcessWithoutNullStreams = spawn('flock', ['-x', '-w', String(waitSeconds), path, 'sh', '-c', 'printf "LOCKED\\n"; cat >/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('LOCKED\n')) resolve();
    });
    child.stderr.on('data', (data: Buffer) => { errorOutput += data.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Workspace lock unavailable (${code}): ${errorOutput.trim()}`)));
  });
  let releasing = false;
  const lost = new Promise<void>((resolve) => { child.once('exit', () => { if (!releasing) resolve(); }); });
  return { lost, release: () => new Promise<void>((resolve) => {
    releasing = true;
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.stdin.end();
  }) };
}
