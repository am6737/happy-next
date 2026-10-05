import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexJsonRpcPeer } from './CodexJsonRpcPeer';

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

describe.skipIf(process.platform === 'win32')('CodexJsonRpcPeer process cleanup', () => {
  let processGroupId: number | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    if (processGroupId && processExists(processGroupId)) {
      try { process.kill(-processGroupId, 'SIGKILL'); } catch { /* already exited */ }
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('kills the detached process group without leaving its child behind', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'happy-codex-peer-'));
    const childPidFile = join(tempDir, 'child.pid');
    const peer = new CodexJsonRpcPeer();

    await peer.spawn('/bin/sh', [
      '-c',
      'sleep 60 & echo $! > "$1"; wait',
      'codex-test',
      childPidFile,
    ], { cwd: tempDir });

    processGroupId = (peer as unknown as { process: { pid?: number } }).process.pid ?? null;
    expect(processGroupId).not.toBeNull();

    const childPid = await waitFor(async () => {
      try {
        const value = Number.parseInt(await readFile(childPidFile, 'utf8'), 10);
        return Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    });
    expect(processExists(processGroupId!)).toBe(true);
    expect(processExists(childPid)).toBe(true);

    await peer.close();

    await waitFor(async () => (
      !processExists(processGroupId!) && !processExists(childPid) ? true : null
    ));
    expect(processExists(processGroupId!)).toBe(false);
    expect(processExists(childPid)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('CodexJsonRpcPeer installs and diagnostics', () => {
  let peer: CodexJsonRpcPeer | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    const pid = peer && (peer as unknown as { process: { pid?: number } | null }).process?.pid;
    await peer?.close();
    if (pid && processExists(pid)) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    peer = null;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  /** A stand-in for `npx`: the peer only cares about the command's name and its stdio. */
  async function fakeNpx(script: string): Promise<number> {
    tempDir = await mkdtemp(join(tmpdir(), 'happy-codex-npx-'));
    const path = join(tempDir, 'npx');
    await writeFile(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    const spawned = new CodexJsonRpcPeer();
    peer = spawned;
    await spawned.spawn(path, ['-y', '@openai/codex@9.9.9', 'app-server'], { cwd: tempDir });
    return spawned.pid!;
  }

  it('carries the process stderr into a request timeout', async () => {
    await fakeNpx('echo "npm error code ETARGET" 1>&2\nsleep 30');
    const buffer = (peer as unknown as { stderrBuffer: string[] });

    await waitFor(async () => (buffer.stderrBuffer.length > 0 ? true : null));

    await expect(peer!.request('initialize', {}, 100)).rejects.toThrow(
      /timed out after 100ms\. stderr:\nnpm error code ETARGET/
    );
  });

  it('leaves an install that never answered the handshake running, so npx can finish', async () => {
    const pid = await fakeNpx('sleep 30');
    await peer!.close();
    expect(processExists(pid)).toBe(true);
  });

  it('still kills the group once Codex has answered the handshake', async () => {
    const pid = await fakeNpx('read line\necho \'{"id":1,"result":{}}\'\nsleep 30');
    expect(await peer!.request('initialize', {})).toEqual({});

    await peer!.close();
    await waitFor(async () => (processExists(pid) ? null : true));
    expect(processExists(pid)).toBe(false);
  });
});
