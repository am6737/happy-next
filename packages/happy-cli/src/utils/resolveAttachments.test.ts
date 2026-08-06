import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { appendAttachmentManifest, decryptAttachmentPayload, pruneAttachmentCache, resolveAttachments } from './resolveAttachments';
import type { AttachmentContent } from '@/api/types';
import { configuration } from '@/configuration';

describe('appendAttachmentManifest', () => {
  it('adds file paths without adding image paths', () => {
    const result = appendAttachmentManifest('Review these', [
      { v: 1, id: 'file-1', kind: 'file', name: 'report.pdf', mimeType: 'application/pdf', size: 10, path: '/repo/.happy/report.pdf' },
      { v: 1, id: 'image-1', kind: 'image', name: 'image.png', mimeType: 'image/png', size: 20, path: '/repo/.happy/image.png' },
    ]);
    expect(result).toContain('report.pdf');
    expect(result).toContain('/repo/.happy/report.pdf');
    expect(result).not.toContain('/repo/.happy/image.png');
  });
});

describe('resolveAttachments', () => {
  it('rejects path traversal in attachment identifiers before writing', async () => {
    await expect(resolveAttachments({
      attachments: [{
        v: 1,
        id: '../../outside',
        kind: 'file',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 4,
      }],
      sessionId: 'session_123',
      cwd: '/tmp/project',
      token: 'token',
    })).rejects.toThrow('Invalid attachment id');
  });

  it('authenticates and decrypts version 2 attachment payloads', () => {
    const plaintext = Buffer.from('private attachment');
    const key = randomBytes(tweetnacl.secretbox.keyLength);
    const nonce = randomBytes(tweetnacl.secretbox.nonceLength);
    const ciphertext = tweetnacl.secretbox(plaintext, nonce, key);
    const attachment: AttachmentContent = {
      v: 2,
      id: 'encrypted-1',
      kind: 'file',
      name: 'private.txt',
      mimeType: 'text/plain',
      size: plaintext.length,
      encryption: {
        algorithm: 'secretbox',
        key: key.toString('base64url'),
        nonce: nonce.toString('base64url'),
        plaintextSha256: createHash('sha256').update(plaintext).digest('hex'),
        ciphertextSize: ciphertext.length,
      },
    };

    expect(Buffer.from(decryptAttachmentPayload(attachment, ciphertext)).toString()).toBe('private attachment');
    ciphertext[0] ^= 1;
    expect(() => decryptAttachmentPayload(attachment, ciphertext)).toThrow('authentication failed');
  });

  it('downloads and resolves attachments sequentially', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'happy-attachment-resolution-'));
    const sessionId = `test-${randomBytes(8).toString('hex')}`;
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    const get = vi.spyOn(axios, 'get').mockImplementation(async () => {
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      const data = Readable.from((async function* () {
        try {
          await new Promise(resolve => setTimeout(resolve, 5));
          yield Buffer.from('data');
        } finally {
          activeDownloads -= 1;
        }
      })());
      return { data } as Awaited<ReturnType<typeof axios.get>>;
    });

    try {
      const attachments: AttachmentContent[] = ['first', 'second', 'third'].map(id => ({
        v: 1,
        id,
        kind: 'file',
        name: `${id}.txt`,
        mimeType: 'text/plain',
        size: 4,
      }));
      const resolved = await resolveAttachments({ attachments, sessionId, cwd, token: 'token' });

      expect(resolved.map(attachment => attachment.id)).toEqual(['first', 'second', 'third']);
      expect(resolved.every(attachment => attachment.path.startsWith(join(configuration.happyHomeDir, 'attachments', sessionId)))).toBe(true);
      expect(resolved.every(attachment => !attachment.path.startsWith(cwd))).toBe(true);
      expect(maxActiveDownloads).toBe(1);
    } finally {
      get.mockRestore();
      await rm(cwd, { recursive: true, force: true });
      await rm(join(configuration.happyHomeDir, 'attachments', sessionId), { recursive: true, force: true });
    }
  });

  it('expires old plaintext and evicts least-recently-used cache files by capacity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happy-attachment-cache-'));
    const session = join(root, 'session-1');
    const expired = join(session, 'expired.txt');
    const oldest = join(session, 'oldest.txt');
    const newest = join(session, 'newest.txt');
    const now = Date.now();
    try {
      await mkdir(session);
      await Promise.all([
        writeFile(expired, 'old'),
        writeFile(oldest, '1234'),
        writeFile(newest, '5678'),
      ]);
      await utimes(expired, new Date(now - 20_000), new Date(now - 20_000));
      await utimes(oldest, new Date(now - 2_000), new Date(now - 2_000));
      await utimes(newest, new Date(now - 1_000), new Date(now - 1_000));

      await pruneAttachmentCache(root, new Set([newest]), { now, ttlMs: 10_000, maxBytes: 4 });

      await expect(stat(expired)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(oldest)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(newest)).resolves.toMatchObject({ size: 4 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
