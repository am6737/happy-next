/**
 * CodexControlSocketClient - JSON-RPC client for a running Codex app-server daemon
 *
 * Desktop clients (e.g. ChatGPT connected over SSH) talk to a long-lived app-server daemon
 * that keeps its own view of the thread list. A separate app-server process only changes
 * disk, so the daemon keeps serving stale threads and never notifies its clients. Sending
 * the request through the daemon's control socket updates it and broadcasts to them.
 *
 * The control socket speaks WebSocket over a Unix domain socket; each frame is one message.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { logger } from '@/ui/logger';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  label: string;
}

/** Control socket of the daemon serving `codexHome`, or null when no daemon was started there. */
export function codexControlSocketPath(codexHome: string): string | null {
  const path = join(codexHome, 'app-server-control', 'app-server-control.sock');
  try {
    // statSync follows the symlink Codex places here; a dangling link means a stale daemon.
    return statSync(path).isSocket() ? path : null;
  } catch {
    return null;
  }
}

export class CodexControlSocketClient {
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;

  private constructor(private readonly socket: WebSocket, signal?: AbortSignal) {
    socket.on('message', (data) => this.handleMessage(data.toString()));
    socket.on('error', (error) => logger.debug('[CodexControl] Socket error', error));
    socket.on('close', () => {
      this.closed = true;
      this.rejectAllPending(new Error('Codex control socket closed'));
    });
    signal?.addEventListener('abort', () => socket.terminate(), { once: true });
  }

  /** Connect to a daemon; rejects when the socket is stale or does not answer the upgrade. */
  static connect(socketPath: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<CodexControlSocketClient> {
    opts.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws+unix://${socketPath}:/`, { handshakeTimeout: opts.timeoutMs });
      socket.once('open', () => {
        socket.removeAllListeners('error');
        resolve(new CodexControlSocketClient(socket, opts.signal));
      });
      socket.once('error', (error) => {
        socket.terminate();
        reject(error);
      });
    });
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.closed) {
      throw new Error(`CodexControlSocketClient: cannot send request '${method}' - socket is closed`);
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CodexControlSocketClient: '${method}' request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer, label: method });
      this.socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.socket.send(JSON.stringify(params === undefined ? { method } : { method, params }));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()));
    this.socket.close();
    const timer = setTimeout(() => this.socket.terminate(), 2_000);
    await closed;
    clearTimeout(timer);
  }

  private handleMessage(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text);
    } catch {
      logger.debug(`[CodexControl] Non-JSON message: ${text.slice(0, 200)}`);
      return;
    }
    if (typeof msg !== 'object' || msg === null || !('id' in msg)) return;

    if ('method' in msg) {
      // This client never opts into server requests; answer so the daemon does not wait on us.
      this.socket.send(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'Unsupported by happy-archive' } }));
      return;
    }

    const pending = this.pendingRequests.get(msg.id as number);
    if (!pending) return;
    this.pendingRequests.delete(msg.id as number);
    clearTimeout(pending.timer);
    if ('error' in msg && msg.error) {
      const err = msg.error as { code: number; message: string };
      pending.reject(new Error(`Codex '${pending.label}' request failed: ${err.message} (code ${err.code})`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
