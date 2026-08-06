import { createHash, randomBytes } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_algorithm: string, data: ArrayBuffer) => {
        const hash = createHash('sha256').update(new Uint8Array(data)).digest();
        return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    },
}));

vi.mock('@/encryption/libsodium.lib', () => ({
    default: {
        ready: Promise.resolve(),
        crypto_secretbox_KEYBYTES: tweetnacl.secretbox.keyLength,
        crypto_secretbox_NONCEBYTES: tweetnacl.secretbox.nonceLength,
        randombytes_buf: (size: number) => new Uint8Array(randomBytes(size)),
        crypto_secretbox_easy: (message: Uint8Array, nonce: Uint8Array, key: Uint8Array) => tweetnacl.secretbox(message, nonce, key),
        crypto_secretbox_open_easy: (ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array) => {
            const plaintext = tweetnacl.secretbox.open(ciphertext, nonce, key);
            if (!plaintext) throw new Error('authentication failed');
            return plaintext;
        },
    },
}));
import { decryptAttachmentBytes, encryptAttachmentBytes, normalizeAttachmentMetadata } from './attachmentCrypto';
import type { AttachmentContent } from './typesRaw';

describe('attachment encryption', () => {
    it('normalizes private metadata before including it in a message', () => {
        expect(normalizeAttachmentMetadata(' ../report\u0000.pdf ', ' Application/PDF\n')).toEqual({
            name: '.._report_.pdf',
            mimeType: 'application/pdf',
        });
        expect(normalizeAttachmentMetadata('', '')).toEqual({
            name: 'attachment',
            mimeType: 'application/octet-stream',
        });
        expect(normalizeAttachmentMetadata('a'.repeat(300), `text/${'x'.repeat(300)}`)).toEqual({
            name: 'a'.repeat(255),
            mimeType: `text/${'x'.repeat(250)}`,
        });
    });

    it('round-trips and authenticates attachment bytes', async () => {
        const plaintext = new TextEncoder().encode('private attachment');
        const encrypted = await encryptAttachmentBytes(plaintext);
        const attachment: AttachmentContent = {
            v: 2,
            id: 'encrypted-1',
            kind: 'file',
            name: 'private.txt',
            mimeType: 'text/plain',
            size: plaintext.length,
            encryption: {
                algorithm: 'secretbox',
                key: encrypted.key,
                nonce: encrypted.nonce,
                plaintextSha256: encrypted.plaintextSha256,
                ciphertextSize: encrypted.ciphertext.length,
            },
        };

        expect(await decryptAttachmentBytes(attachment, encrypted.ciphertext)).toEqual(plaintext);
        encrypted.ciphertext[0] ^= 1;
        await expect(decryptAttachmentBytes(attachment, encrypted.ciphertext)).rejects.toThrow('authentication failed');
    });
});
