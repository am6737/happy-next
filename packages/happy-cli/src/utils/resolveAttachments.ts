import axios from 'axios';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rmdir, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import tweetnacl from 'tweetnacl';
import { configuration } from '@/configuration';
import { decodeBase64 } from '@/api/encryption';
import type { AttachmentContent } from '@/api/types';

export type ResolvedAttachment = AttachmentContent & { path: string };

const DEFAULT_ATTACHMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ATTACHMENT_CACHE_MAX_BYTES = 512 * 1024 * 1024;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export async function pruneAttachmentCache(
  root: string,
  protectedPaths: ReadonlySet<string> = new Set(),
  options: { now?: number; ttlMs?: number; maxBytes?: number } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? positiveIntegerFromEnv('HAPPY_ATTACHMENT_CACHE_TTL_MS', DEFAULT_ATTACHMENT_CACHE_TTL_MS);
  const maxBytes = options.maxBytes ?? positiveIntegerFromEnv('HAPPY_ATTACHMENT_CACHE_MAX_BYTES', DEFAULT_ATTACHMENT_CACHE_MAX_BYTES);
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const sessionDirectories: string[] = [];
  const sessions = await readdir(root, { withFileTypes: true }).catch(() => []);

  for (const session of sessions) {
    if (!session.isDirectory()) continue;
    const sessionDirectory = join(root, session.name);
    sessionDirectories.push(sessionDirectory);
    const entries = await readdir(sessionDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(sessionDirectory, entry.name);
      const details = await stat(path).catch(() => null);
      if (details?.isFile()) files.push({ path, size: details.size, mtimeMs: details.mtimeMs });
    }
  }

  let retainedBytes = files.reduce((total, file) => total + file.size, 0);
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    const expired = now - file.mtimeMs > ttlMs;
    if (protectedPaths.has(file.path) || (!expired && retainedBytes <= maxBytes)) continue;
    try {
      await unlink(file.path);
      retainedBytes -= file.size;
    } catch {
      // Cache cleanup is best-effort and must not prevent attachment resolution.
    }
  }

  await Promise.all(sessionDirectories.map((directory) => rmdir(directory).catch(() => undefined)));
}

function safeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function safeFilename(attachment: AttachmentContent): string {
  const clean = basename(attachment.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);
  return `${safeId(attachment.id, 'attachment id')}${extname(clean).slice(0, 16)}`;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function decryptAttachmentPayload(attachment: AttachmentContent, payload: Uint8Array): Uint8Array {
  if (attachment.v === 1) return payload;
  if (payload.length !== attachment.encryption.ciphertextSize) {
    throw new Error(`Attachment ${attachment.id} ciphertext size mismatch`);
  }

  const key = decodeBase64(attachment.encryption.key, 'base64url');
  const nonce = decodeBase64(attachment.encryption.nonce, 'base64url');
  if (key.length !== tweetnacl.secretbox.keyLength || nonce.length !== tweetnacl.secretbox.nonceLength) {
    throw new Error(`Attachment ${attachment.id} has invalid encryption parameters`);
  }

  const plaintext = tweetnacl.secretbox.open(payload, nonce, key);
  if (!plaintext) throw new Error(`Attachment ${attachment.id} authentication failed`);
  if (plaintext.length !== attachment.size) throw new Error(`Attachment ${attachment.id} plaintext size mismatch`);
  if (sha256Hex(plaintext) !== attachment.encryption.plaintextSha256) {
    throw new Error(`Attachment ${attachment.id} digest mismatch`);
  }
  return plaintext;
}

export async function resolveAttachments(input: {
  attachments: AttachmentContent[];
  sessionId: string;
  cwd: string;
  token: string;
  signal?: AbortSignal;
}): Promise<ResolvedAttachment[]> {
  if (input.attachments.length === 0) return [];
  const sessionId = safeId(input.sessionId, 'session id');
  input.attachments.forEach((attachment) => safeId(attachment.id, 'attachment id'));
  if (new Set(input.attachments.map((attachment) => attachment.id)).size !== input.attachments.length) {
    throw new Error('Duplicate attachment id');
  }
  const cacheRoot = join(configuration.happyHomeDir, 'attachments');
  const directory = join(cacheRoot, sessionId);
  const targets = new Set(input.attachments.map((attachment) => join(directory, safeFilename(attachment))));
  await pruneAttachmentCache(cacheRoot, targets).catch(() => undefined);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);

  const resolvedAttachments: ResolvedAttachment[] = [];
  for (const attachment of input.attachments) {
    const target = join(directory, safeFilename(attachment));
    const existing = await stat(target).catch(() => null);
    if (existing?.isFile() && existing.size === attachment.size) {
      if (attachment.v === 1 || sha256Hex(await readFile(target)) === attachment.encryption.plaintextSha256) {
        const now = new Date();
        await utimes(target, now, now).catch(() => undefined);
        resolvedAttachments.push({ ...attachment, path: target });
        continue;
      }
    }

    const partial = `${target}.part`;
    const encryptedPartial = `${target}.encrypted.part`;
    await unlink(partial).catch(() => undefined);
    await unlink(encryptedPartial).catch(() => undefined);
    const expectedDownloadSize = attachment.v === 2 ? attachment.encryption.ciphertextSize : attachment.size;
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > expectedDownloadSize || received > 25 * 1024 * 1024 + tweetnacl.secretbox.overheadLength) {
          callback(new Error(`Attachment ${attachment.id} exceeded its declared size`));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      const response = await axios.get(
        `${configuration.serverUrl}/v1/chat/attachments/${encodeURIComponent(attachment.id)}/download`,
        {
          headers: { Authorization: `Bearer ${input.token}` },
          responseType: 'stream',
          timeout: 60_000,
          signal: input.signal,
          maxRedirects: 0,
        },
      );
      const downloadTarget = attachment.v === 2 ? encryptedPartial : partial;
      await pipeline(response.data, limiter, createWriteStream(downloadTarget, { mode: 0o600 }));
      if (received !== expectedDownloadSize) throw new Error(`Attachment ${attachment.id} size mismatch`);
      if (attachment.v === 2) {
        const plaintext = decryptAttachmentPayload(attachment, await readFile(encryptedPartial));
        await writeFile(partial, plaintext, { mode: 0o600 });
        await unlink(encryptedPartial);
      }
      await rename(partial, target);
      resolvedAttachments.push({ ...attachment, path: target });
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      await unlink(encryptedPartial).catch(() => undefined);
      throw error;
    }
  }
  await pruneAttachmentCache(cacheRoot, new Set(resolvedAttachments.map((attachment) => attachment.path))).catch(() => undefined);
  return resolvedAttachments;
}

export function appendAttachmentManifest(text: string, attachments: ResolvedAttachment[]): string {
  const files = attachments.filter((attachment) => attachment.kind === 'file');
  if (files.length === 0) return text;
  const manifest = files.map(({ name, mimeType, size, path }) => ({ name, mimeType, size, path }));
  return `${text}\n\nAttached files are available at these local paths:\n${JSON.stringify(manifest)}`.trim();
}
