import os from 'os';
import { createReadStream, createWriteStream } from 'fs';
import { chmod, lstat, mkdir, rename, rm, stat } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
} from 'crypto';
import * as tar from 'tar';
import type { EventEmitter } from 'events';
import axios from 'axios';

import type { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { delay } from '@/utils/time';
import { reportWithRetry } from '@/daemon/orchestratorShell';
import type {
  OrchestratorCancelPayload,
  OrchestratorFinishStatus,
  OrchestratorTransferDispatchPayload,
  OrchestratorTransferResult,
  OrchestratorTransferSourceParams,
  OrchestratorTransferSourceRequest,
} from '@/orchestrator/common';
import {
  openOrchestrator,
  sealOrchestrator,
  type OrchestratorEnvelopeOpener,
  type OrchestratorTaskEnvelope,
  type OrchestratorTransferKey,
} from '@/orchestrator/seal';

// What one relayed step carries: base64 makes it a third larger, within the 5 MB a socket message takes
export const TRANSFER_CHUNK_BYTES = 2 * 1024 * 1024;
export const TRANSFER_MAX_BYTES = 2 * 1024 * 1024 * 1024;
// A source no step has come for in this long was abandoned by its target
const SOURCE_IDLE_MS = 2 * 60_000;
// A step whose relay failed on the way (network, the source reconnecting) is tried again this often
const RELAY_ATTEMPTS = 5;
const RELAY_RETRY_DELAY_MS = 2_000;
const TRANSFER_SHUTDOWN_WAIT_MS = 8_000;
// The server fails an execution whose start it has not heard of within a minute
const START_REPORT_DEADLINE_MS = 45_000;
const KEY_INFO = 'happy-orchestrator-transfer-v1';

/** What the source answers to `open`; its public key sealed (OrchestratorTransferKey) */
type SourceOpened = {
  name: string;
  kind: 'file' | 'directory';
  /** Bytes of a file; null for a directory, whose size shows only as it streams */
  size: number | null;
  mode: number;
  publicKey: string;
};

/** What the source answers to `read`: the chunk sealed (base64), and whether it is the last */
type SealedChunk = { data: string; eof: boolean };

type SourceSession = {
  key: Buffer;
  chunks: AsyncIterator<Buffer>;
  stream: { destroy: () => void };
  next: number;
  // Answered again when its read is retried (the answer was lost on the way)
  last: { index: number; chunk: SealedChunk } | null;
  idleTimer: NodeJS.Timeout;
};

type TargetTransfer = {
  payload: OrchestratorTransferDispatchPayload;
  spec: Extract<OrchestratorTaskEnvelope, { kind: 'transfer' }>;
  abort: AbortController;
  cancelRequested: boolean;
  watchdogTriggered: boolean;
  startReport: Promise<void>;
};

/** A failure with the code the finish report gives it */
class TransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** `~` is the home directory, and a relative path is relative to it, as in a login shell */
export function resolveUserPath(path: string): string {
  return resolve(os.homedir(), path.replace(/^~(?=$|[\\/])/, os.homedir()));
}

/** An end's public key as the other sent it, sealed with the orchestrator key */
function openTransferKey(sealed: unknown, key: Uint8Array, executionId: string, role: OrchestratorTransferKey['role']): string {
  const opened = openOrchestrator<OrchestratorTransferKey>(sealed, key);
  if (opened?.kind !== 'transfer-key' || opened.executionId !== executionId || opened.role !== role) {
    throw new TransferError('TRANSFER_KEY_REJECTED', `The ${role} machine's key is not sealed with the orchestrator key for this transfer`);
  }
  return opened.publicKey;
}

/** An X25519 key pair for one transfer; the public key travels as base64url (its JWK `x`) */
export function createTransferKeyPair(): { privateKey: KeyObject; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return { privateKey, publicKey: publicKey.export({ format: 'jwk' }).x! };
}

/** The AES-256-GCM key both ends derive from their own private key and the other's public key */
export function deriveTransferKey(privateKey: KeyObject, peerPublicKey: string, transferId: string): Buffer {
  const shared = diffieHellman({
    privateKey,
    publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: peerPublicKey }, format: 'jwk' }),
  });
  return Buffer.from(hkdfSync('sha256', shared, transferId, KEY_INFO, 32));
}

// A chunk's nonce is its index: unique under the key, which is new for every transfer. The index
// and whether the chunk is the last are authenticated, so chunks cannot be reordered, repeated or
// cut off without the target noticing.
function chunkCipherParams(transferId: string, index: number, eof: boolean) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(index), 4);
  return { nonce, aad: Buffer.from(`${transferId}:${index}:${eof ? 1 : 0}`) };
}

export function sealTransferChunk(key: Buffer, transferId: string, index: number, eof: boolean, plaintext: Buffer): string {
  const { nonce, aad } = chunkCipherParams(transferId, index, eof);
  const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

export function openTransferChunk(key: Buffer, transferId: string, index: number, eof: boolean, sealed: string): Buffer {
  const { nonce, aad } = chunkCipherParams(transferId, index, eof);
  const data = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce).setAAD(aad).setAuthTag(data.subarray(-16));
  try {
    return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  } catch {
    throw new TransferError('TRANSFER_CORRUPTED', `Chunk ${index} failed its integrity check`);
  }
}

/** A stream in pieces of TRANSFER_CHUNK_BYTES (the last one shorter), at most TRANSFER_MAX_BYTES in all */
async function* fixedChunks(stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let total = 0;
  for await (const piece of stream) {
    total += piece.length;
    if (total > TRANSFER_MAX_BYTES) {
      throw new Error(`Source is larger than the ${TRANSFER_MAX_BYTES / 1024 ** 3} GiB a transfer takes`);
    }
    pending.push(piece);
    pendingBytes += piece.length;
    while (pendingBytes >= TRANSFER_CHUNK_BYTES) {
      const all = Buffer.concat(pending);
      yield all.subarray(0, TRANSFER_CHUNK_BYTES);
      pending = [all.subarray(TRANSFER_CHUNK_BYTES)];
      pendingBytes -= TRANSFER_CHUNK_BYTES;
    }
  }
  if (pendingBytes > 0) {
    yield Buffer.concat(pending);
  }
}

/**
 * Where a transfer puts what it receives, as `cp` would: inside `targetPath` (under the source's
 * name) when it ends with a separator or is a directory, at `targetPath` itself otherwise.
 */
export async function resolveTransferDestination(targetPath: string, sourceName: string): Promise<string> {
  const target = resolveUserPath(targetPath);
  const intoDirectory = /[\\/]$/.test(targetPath) || (await stat(target).catch(() => null))?.isDirectory();
  return intoDirectory ? join(target, sourceName) : target;
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof TransferError) {
    return { code: error.code, message: error.message };
  }
  if (axios.isAxiosError(error)) {
    const serverError = (error.response?.data as { error?: { code?: string; message?: string } } | undefined)?.error;
    return { code: serverError?.code ?? 'TRANSFER_RELAY_FAILED', message: serverError?.message ?? error.message };
  }
  return { code: 'TRANSFER_FAILED', message: error instanceof Error ? error.message : String(error) };
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Runs the file transfers the orchestrator dispatches to this machine, and serves this machine's
 * files to the transfers other machines run.
 *
 * A transfer runs on its target: it pulls the source chunk by chunk through the server, which
 * relays each step to the source machine (`serveSource`). The two machines agree on a key over
 * X25519 when the transfer opens and the source seals every chunk with AES-256-GCM, so the server
 * relays only ciphertext. What to copy comes sealed in the task's envelope, which `opener` opens
 * and checks on both machines, and the public keys travel sealed with the orchestrator key, so
 * the server cannot put its own in between. A directory travels as a tar stream. What arrives is written beside its
 * destination and renamed into place once complete, so a failed or cancelled transfer leaves
 * nothing half-written behind.
 */
export function createOrchestratorTransferExecutor(api: ApiClient, opener: OrchestratorEnvelopeOpener) {
  const transfers = new Map<string, TargetTransfer>();
  const sources = new Map<string, SourceSession>();

  const closeSource = (transferId: string) => {
    const session = sources.get(transferId);
    if (!session) {
      return;
    }
    clearTimeout(session.idleTimer);
    session.stream.destroy();
    sources.delete(transferId);
  };

  // One step of the transfer through the server, again while it fails on the way there
  const relay = async <T>(transfer: TargetTransfer, request: OrchestratorTransferSourceRequest): Promise<T> => {
    const { executionId, dispatchToken } = transfer.payload;
    for (let attempt = 1; ; attempt++) {
      try {
        return await api.orchestratorTransferSource<T>(executionId, dispatchToken, transfer.spec.sourceMachineId, request, transfer.abort.signal);
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const final = transfer.abort.signal.aborted
          || (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429);
        if (final || attempt >= RELAY_ATTEMPTS) {
          throw error;
        }
        logger.debug(`[ORCHESTRATOR TRANSFER] ${request.op} of ${executionId} failed, retrying`, error);
        await delay(RELAY_RETRY_DELAY_MS);
      }
    }
  };

  const receive = async (transfer: TargetTransfer): Promise<OrchestratorTransferResult> => {
    const { executionId } = transfer.payload;
    const { spec } = transfer;
    const sealKey = await api.orchestratorKey();
    const { privateKey, publicKey } = createTransferKeyPair();
    const source = await relay<SourceOpened>(transfer, {
      op: 'open',
      publicKey: sealOrchestrator({ kind: 'transfer-key', executionId, publicKey, role: 'target' } satisfies OrchestratorTransferKey, sealKey),
    });
    const key = deriveTransferKey(privateKey, openTransferKey(source.publicKey, sealKey, executionId, 'source'), executionId);

    const destination = await resolveTransferDestination(spec.targetPath, source.name);
    const existing = await lstat(destination).catch(() => null);
    if (existing && !spec.overwrite) {
      throw new TransferError('DESTINATION_EXISTS', `${destination} already exists; transfer with overwrite to replace it`);
    }
    if (existing && existing.isDirectory() !== (source.kind === 'directory')) {
      throw new TransferError('DESTINATION_EXISTS', `${destination} is a ${existing.isDirectory() ? 'directory' : 'file'}, which a ${source.kind} cannot replace`);
    }
    await mkdir(dirname(destination), { recursive: true });

    const temp = join(dirname(destination), `.${basename(destination)}.happy-transfer-${executionId}`);
    const hash = createHash('sha256');
    let files = source.kind === 'file' ? 1 : 0;
    // A directory reports what its files hold, not the tar stream (headers and padding) that carried them
    let fileBytes = 0;
    let streamed = 0;
    if (source.kind === 'directory') {
      await mkdir(temp);
    }
    // A directory's tar stream unpacks as it arrives; `strip` drops its top directory, which is temp
    const sink = source.kind === 'file'
      ? createWriteStream(temp, { mode: 0o600 })
      : new tar.Unpack({
        cwd: temp,
        strip: 1,
        strict: true,
        onReadEntry: (entry) => {
          files += entry.type === 'File' ? 1 : 0;
          fileBytes += entry.type === 'File' ? entry.size : 0;
        },
      });
    // Both are event emitters, with event maps too different to call through the union
    const sinkEvents: EventEmitter = sink;
    let sinkError: Error | null = null;
    const done = new Promise<void>((resolveDone, rejectDone) => {
      sinkEvents.once(source.kind === 'file' ? 'close' : 'end', () => resolveDone());
      sinkEvents.once('error', (error: Error) => {
        sinkError = error;
        rejectDone(error);
      });
    });
    done.catch(() => {});

    try {
      for (let index = 0; ; index++) {
        const chunk = await relay<SealedChunk>(transfer, { op: 'read', index });
        const plaintext = openTransferChunk(key, executionId, index, chunk.eof, chunk.data);
        streamed += plaintext.length;
        if (streamed > TRANSFER_MAX_BYTES) {
          throw new TransferError('TRANSFER_TOO_LARGE', `Source is larger than the ${TRANSFER_MAX_BYTES / 1024 ** 3} GiB a transfer takes`);
        }
        hash.update(plaintext);
        if (!sink.write(plaintext)) {
          await new Promise<void>((resolveDrain) => {
            sinkEvents.once('drain', resolveDrain);
            sinkEvents.once('error', () => resolveDrain());
          });
        }
        if (sinkError) {
          throw sinkError;
        }
        if (chunk.eof) {
          break;
        }
      }
      sink.end();
      await done;

      await chmod(temp, source.mode);
      // A directory cannot be renamed over another: the old one moves aside until the new one is in place
      const replaced = existing?.isDirectory() ? `${temp}.old` : null;
      if (replaced) {
        await rename(destination, replaced);
      }
      await rename(temp, destination);
      if (replaced) {
        await rm(replaced, { recursive: true, force: true });
      }
    } catch (error) {
      if (sink instanceof tar.Unpack) {
        sink.abort(error instanceof Error ? error : new Error(String(error)));
      } else {
        sink.destroy();
      }
      // An unpack that was cut off may not say it has stopped
      await Promise.race([done.catch(() => {}), delay(5_000)]);
      await rm(temp, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    return {
      path: destination,
      kind: source.kind,
      bytes: source.kind === 'file' ? streamed : fileBytes,
      files,
      sha256: source.kind === 'file' ? hash.digest('hex') : null,
    };
  };

  const run = async (transfer: TargetTransfer, watchdogTimer: NodeJS.Timeout | null) => {
    const { payload } = transfer;
    let status: OrchestratorFinishStatus = 'completed';
    let result: OrchestratorTransferResult | null = null;
    let error: { code: string; message: string } | null = null;
    try {
      result = await receive(transfer);
    } catch (caught) {
      status = transfer.watchdogTriggered ? 'timeout' : transfer.cancelRequested ? 'cancelled' : 'failed';
      error = status === 'timeout'
        ? { code: 'WATCHDOG_TIMEOUT', message: `Transfer exceeded timeout (${payload.timeoutMs}ms)` }
        : status === 'cancelled'
          ? { code: 'CANCELLED', message: 'Transfer was cancelled' }
          : describeError(caught);
      logger.debug(`[ORCHESTRATOR TRANSFER] Execution ${payload.executionId} ${status}`, caught);
    }
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }
    // The source keeps the transfer open for retries until told it is over
    void api.orchestratorTransferSource(payload.executionId, payload.dispatchToken, transfer.spec.sourceMachineId, { op: 'close' })
      .catch((closeError) => logger.debug(`[ORCHESTRATOR TRANSFER] Failed to close source of ${payload.executionId}`, closeError));

    const summary = result
      ? `${result.kind === 'directory' ? `${result.files} files, ` : ''}${formatBytes(result.bytes)} → ${result.path}`
      : error?.message ?? null;
    await transfer.startReport;
    await reportWithRetry(`finish of execution ${payload.executionId}`, () => api.reportOrchestratorExecutionFinish({
      executionId: payload.executionId,
      taskId: payload.taskId,
      dispatchToken: payload.dispatchToken,
      status,
      finishedAt: new Date().toISOString(),
      outputSummary: summary,
      transferResult: result,
      errorCode: error?.code,
      errorMessage: error?.message,
    }), Infinity);
    transfers.delete(payload.executionId);
  };

  return {
    dispatch: async (payload: OrchestratorTransferDispatchPayload): Promise<{ accepted: boolean; duplicate?: boolean }> => {
      // Opened first: from the check below to starting the transfer nothing waits, so a dispatch
      // the server repeated cannot start it twice
      const { envelope: spec } = await opener.open('transfer', payload);
      const existing = transfers.get(payload.executionId);
      if (existing) {
        if (existing.payload.dispatchToken !== payload.dispatchToken) {
          throw new Error(`Execution ${payload.executionId} already running with different dispatchToken`);
        }
        return { accepted: true, duplicate: true };
      }

      const transfer: TargetTransfer = {
        payload,
        spec,
        abort: new AbortController(),
        cancelRequested: false,
        watchdogTriggered: false,
        startReport: reportWithRetry(`start of execution ${payload.executionId}`, () => api.reportOrchestratorExecutionStart({
          executionId: payload.executionId,
          dispatchToken: payload.dispatchToken,
          startedAt: new Date().toISOString(),
        }), Date.now() + START_REPORT_DEADLINE_MS),
      };
      transfers.set(payload.executionId, transfer);
      const watchdogTimer = payload.timeoutMs === null ? null : setTimeout(() => {
        transfer.watchdogTriggered = true;
        transfer.abort.abort();
      }, payload.timeoutMs);
      void run(transfer, watchdogTimer);
      logger.debug(`[ORCHESTRATOR TRANSFER] Started execution ${payload.executionId}`);
      return { accepted: true };
    },

    /** One step of serving a file or directory of this machine to another's transfer */
    serveSource: async (params: OrchestratorTransferSourceParams): Promise<SourceOpened | SealedChunk | { closed: boolean }> => {
      const { transferId } = params;
      if (params.op === 'close') {
        const closed = sources.has(transferId);
        closeSource(transferId);
        return { closed };
      }

      if (params.op === 'open') {
        // Opened again when the target retried: the answer to the first open never reached it
        closeSource(transferId);
        const spec = await opener.openSource(params.spec);
        const sealKey = await api.orchestratorKey();
        const peerPublicKey = openTransferKey(params.publicKey, sealKey, transferId, 'target');
        const path = resolveUserPath(spec.sourcePath);
        const info = await stat(path).catch(() => null);
        if (!info || (!info.isFile() && !info.isDirectory())) {
          throw new Error(info ? `${path} is neither a file nor a directory` : `${path} does not exist`);
        }
        if (info.isFile() && info.size > TRANSFER_MAX_BYTES) {
          throw new Error(`${path} is ${formatBytes(info.size)}, more than the ${TRANSFER_MAX_BYTES / 1024 ** 3} GiB a transfer takes`);
        }
        const kind = info.isFile() ? 'file' as const : 'directory' as const;
        const stream = kind === 'file'
          ? createReadStream(path, { highWaterMark: TRANSFER_CHUNK_BYTES })
          : tar.create({ cwd: dirname(path), portable: true }, [basename(path)]);
        const { privateKey, publicKey } = createTransferKeyPair();
        const session: SourceSession = {
          key: deriveTransferKey(privateKey, peerPublicKey, transferId),
          chunks: fixedChunks(stream as AsyncIterable<Buffer>),
          stream,
          next: 0,
          last: null,
          idleTimer: setTimeout(() => closeSource(transferId), SOURCE_IDLE_MS).unref(),
        };
        sources.set(transferId, session);
        logger.debug(`[ORCHESTRATOR TRANSFER] Serving ${path} for ${transferId}`);
        return {
          name: basename(path),
          kind,
          size: kind === 'file' ? info.size : null,
          mode: info.mode & 0o777,
          publicKey: sealOrchestrator({ kind: 'transfer-key', executionId: transferId, publicKey, role: 'source' } satisfies OrchestratorTransferKey, sealKey),
        };
      }

      const session = sources.get(transferId);
      if (!session) {
        throw new Error('Transfer is not open on the source machine (it restarted or the transfer sat idle too long)');
      }
      session.idleTimer.refresh();
      if (session.last?.index === params.index) {
        return session.last.chunk;
      }
      if (params.index !== session.next) {
        throw new Error(`Chunk ${params.index} requested, ${session.next} expected`);
      }
      const { value, done } = await session.chunks.next().catch((error) => {
        closeSource(transferId);
        throw error;
      });
      const eof = !!done;
      const chunk = { data: sealTransferChunk(session.key, transferId, params.index, eof, done ? Buffer.alloc(0) : value), eof };
      session.last = { index: params.index, chunk };
      session.next += 1;
      return chunk;
    },

    /** Cancel a running transfer; `null` if it is not one of the transfers. */
    cancel: (payload: OrchestratorCancelPayload): { accepted: boolean } | null => {
      const transfer = transfers.get(payload.executionId);
      if (!transfer) {
        return null;
      }
      if (transfer.payload.dispatchToken !== payload.dispatchToken) {
        throw new Error(`dispatchToken mismatch for execution ${payload.executionId}`);
      }
      transfer.cancelRequested = true;
      transfer.abort.abort();
      return { accepted: true };
    },

    liveExecutionIds: () => [...transfers.keys()],

    /** Stop every transfer (the daemon is shutting down), waiting a while for their reports. */
    stopAll: async () => {
      for (const transferId of [...sources.keys()]) {
        closeSource(transferId);
      }
      for (const transfer of transfers.values()) {
        transfer.cancelRequested = true;
        transfer.abort.abort();
      }
      const deadline = Date.now() + TRANSFER_SHUTDOWN_WAIT_MS;
      while (transfers.size > 0 && Date.now() < deadline) {
        await delay(100);
      }
    },
  };
}
