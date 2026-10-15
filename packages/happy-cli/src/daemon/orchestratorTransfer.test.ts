import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AxiosError, type AxiosResponse } from 'axios';

import type { ApiClient } from '@/api/api';
import type { OrchestratorTransferDispatchPayload, OrchestratorTransferSourceRequest } from '@/orchestrator/common';
import { createOrchestratorEnvelopeOpener, sealOrchestrator } from '@/orchestrator/seal';
import {
  createOrchestratorTransferExecutor,
  createTransferKeyPair,
  deriveTransferKey,
  openTransferChunk,
  sealTransferChunk,
  TRANSFER_CHUNK_BYTES,
} from './orchestratorTransfer';

type FinishReport = Parameters<ApiClient['reportOrchestratorExecutionFinish']>[0];

const tempDir = mkdtempSync(join(tmpdir(), 'happy-transfer-test-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const key = new Uint8Array(32).fill(9);

/**
 * One executor serving as both ends, with the server's relay in between: a step reaches
 * `serveSource` as the server passes it on, and a source failure comes back as the server's 422.
 */
function setup(serveSpec: (spec: string) => string = (spec) => spec) {
  const finished = new Map<string, (report: FinishReport) => void>();
  const relayed: Array<{ request: OrchestratorTransferSourceRequest; answer: unknown }> = [];
  const api = {
    reportOrchestratorExecutionStart: vi.fn(async () => {}),
    reportOrchestratorExecutionFinish: vi.fn(async (report: FinishReport) => {
      finished.get(report.executionId)?.(report);
    }),
    orchestratorKey: vi.fn(async () => key),
    orchestratorTransferSource: vi.fn(async (executionId: string, _token: string, _source: string, request: OrchestratorTransferSourceRequest) => {
      try {
        const answer = await executor.serveSource({ ...request, transferId: executionId, spec: serveSpec(specs.get(executionId)!) });
        relayed.push({ request, answer });
        return answer;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new AxiosError(message, 'ERR_BAD_REQUEST', undefined, undefined, {
          status: 422,
          data: { ok: false, error: { code: 'SOURCE_FAILED', message } },
        } as AxiosResponse);
      }
    }),
  } as unknown as ApiClient;
  const specs = new Map<string, string>();
  // One machine is both ends: the source and the target of every transfer
  const opener = createOrchestratorEnvelopeOpener({
    loadKey: async () => key,
    machineId: 'machine-a',
    seenFile: join(mkdtempSync(join(tempDir, 'seen-')), 'seals.json'),
  });
  const executor = createOrchestratorTransferExecutor(api, opener);
  let next = 0;
  const transfer = async (sourcePath: string, targetPath: string, overwrite = false) => {
    const executionId = `exec-${next++}`;
    const spec = sealOrchestrator({
      kind: 'transfer', sealId: `seal-${executionId}`, createdAt: Date.now(), machineIds: ['machine-a'], maxAttempts: 1,
      sourceMachineId: 'machine-a', sourcePath, targetPath, overwrite,
    }, key);
    specs.set(executionId, spec);
    const report = new Promise<FinishReport>((resolve) => finished.set(executionId, resolve));
    const payload: OrchestratorTransferDispatchPayload = {
      executionId,
      runId: 'run-1',
      taskId: `task-${executionId}`,
      dispatchToken: `token-${executionId}`,
      provider: 'transfer',
      prompt: spec,
      timeoutMs: null,
    };
    await executor.dispatch(payload);
    return report;
  };
  return { executor, transfer, relayed };
}

function makeDir(name: string): string {
  const dir = join(tempDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('transfer chunk encryption', () => {
  it('opens what the other end sealed, and only for the same chunk', () => {
    const target = createTransferKeyPair();
    const source = createTransferKeyPair();
    const targetKey = deriveTransferKey(target.privateKey, source.publicKey, 'exec-1');
    const sourceKey = deriveTransferKey(source.privateKey, target.publicKey, 'exec-1');
    expect(targetKey.equals(sourceKey)).toBe(true);

    const plaintext = randomBytes(1000);
    const sealed = sealTransferChunk(sourceKey, 'exec-1', 3, false, plaintext);
    expect(openTransferChunk(targetKey, 'exec-1', 3, false, sealed).equals(plaintext)).toBe(true);
    // Another position, a forged end, or another transfer's key all fail
    expect(() => openTransferChunk(targetKey, 'exec-1', 4, false, sealed)).toThrow('integrity');
    expect(() => openTransferChunk(targetKey, 'exec-1', 3, true, sealed)).toThrow('integrity');
    const otherKey = deriveTransferKey(target.privateKey, source.publicKey, 'exec-2');
    expect(() => openTransferChunk(otherKey, 'exec-1', 3, false, sealed)).toThrow('integrity');
  });
});

describe.skipIf(process.platform === 'win32')('orchestrator transfer executor', () => {
  it('copies a file of several chunks into a directory, keeping its mode', async () => {
    const { executor, transfer, relayed } = setup();
    const content = randomBytes(TRANSFER_CHUNK_BYTES * 2 + 1234);
    const source = join(makeDir('file-src'), 'tool.bin');
    writeFileSync(source, content);
    chmodSync(source, 0o750);
    const targetDir = join(tempDir, 'file-dst');

    const report = await transfer(source, `${targetDir}/`);

    const destination = join(targetDir, 'tool.bin');
    expect(report).toMatchObject({
      status: 'completed',
      transferResult: {
        path: destination,
        kind: 'file',
        bytes: content.length,
        files: 1,
        sha256: createHash('sha256').update(content).digest('hex'),
      },
    });
    expect(readFileSync(destination).equals(content)).toBe(true);
    expect(statSync(destination).mode & 0o777).toBe(0o750);
    // What the server relays is ciphertext only
    const sealedChunks = relayed.filter(({ request }) => request.op === 'read');
    expect(sealedChunks).toHaveLength(4);
    expect(JSON.stringify(sealedChunks)).not.toContain(content.subarray(0, 64).toString('base64'));
    // No temporary file is left beside it, and the source was closed
    expect(readdirSync(targetDir)).toEqual(['tool.bin']);
    await vi.waitFor(() => expect(relayed.at(-1)?.request.op).toBe('close'));
    expect(executor.liveExecutionIds()).toHaveLength(0);
  });

  it('copies a directory to an exact path, creating its parents', async () => {
    const { transfer } = setup();
    const source = makeDir('dir-src/project');
    mkdirSync(join(source, 'nested'));
    writeFileSync(join(source, 'a.txt'), 'alpha');
    writeFileSync(join(source, 'nested', 'b.txt'), 'beta');
    const destination = join(tempDir, 'dir-dst', 'deep', 'copy');

    const report = await transfer(source, destination);

    expect(report).toMatchObject({
      status: 'completed',
      transferResult: { path: destination, kind: 'directory', bytes: 'alpha'.length + 'beta'.length, files: 2, sha256: null },
    });
    expect(readFileSync(join(destination, 'a.txt'), 'utf8')).toBe('alpha');
    expect(readFileSync(join(destination, 'nested', 'b.txt'), 'utf8')).toBe('beta');
    expect(readdirSync(join(tempDir, 'dir-dst', 'deep'))).toEqual(['copy']);
  });

  it('refuses an existing destination unless told to overwrite it', async () => {
    const { transfer } = setup();
    const source = join(makeDir('over-src'), 'config.json');
    writeFileSync(source, 'new');
    const destination = join(makeDir('over-dst'), 'config.json');
    writeFileSync(destination, 'old');

    const refused = await transfer(source, destination);
    expect(refused).toMatchObject({ status: 'failed', errorCode: 'DESTINATION_EXISTS', transferResult: null });
    expect(readFileSync(destination, 'utf8')).toBe('old');

    const replaced = await transfer(source, destination, true);
    expect(replaced.status).toBe('completed');
    expect(readFileSync(destination, 'utf8')).toBe('new');
  });

  it('replaces a directory as a whole when overwriting', async () => {
    const { transfer } = setup();
    const source = makeDir('replace-src/site');
    writeFileSync(join(source, 'index.html'), 'v2');
    const destination = makeDir('replace-dst/site');
    writeFileSync(join(destination, 'stale.html'), 'v1');

    const report = await transfer(source, join(tempDir, 'replace-dst/'), true);

    expect(report.status).toBe('completed');
    expect(readdirSync(destination)).toEqual(['index.html']);
    expect(readdirSync(join(tempDir, 'replace-dst'))).toEqual(['site']);
  });

  it('fails with the source machine\'s reason when the source is missing', async () => {
    const { transfer } = setup();
    const destination = join(tempDir, 'missing-dst', 'x');

    const report = await transfer(join(tempDir, 'does-not-exist'), destination);

    expect(report).toMatchObject({ status: 'failed', errorCode: 'SOURCE_FAILED' });
    expect(report.errorMessage).toContain('does not exist');
    expect(existsSync(destination)).toBe(false);
  });

  it('serves nothing for a spec not sealed with the orchestrator key', async () => {
    const source = join(makeDir('forged-src'), 'secret.txt');
    writeFileSync(source, 'secret');
    const forged = JSON.stringify({ sourceMachineId: 'machine-a', sourcePath: source });
    const { transfer, relayed } = setup(() => forged);
    const destination = join(tempDir, 'forged-dst', 'secret.txt');

    const report = await transfer(source, destination);

    expect(report).toMatchObject({ status: 'failed', errorCode: 'SOURCE_FAILED' });
    expect(report.errorMessage).toContain('not sealed with the orchestrator key');
    expect(relayed.filter(({ request }) => request.op !== 'close')).toHaveLength(0);
    expect(existsSync(destination)).toBe(false);
  });
});
