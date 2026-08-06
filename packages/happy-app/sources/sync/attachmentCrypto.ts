import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import sodium from '@/encryption/libsodium.lib';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import type { AttachmentContent } from './typesRaw';

const MAX_ATTACHMENT_METADATA_LENGTH = 255;

export function normalizeAttachmentMetadata(name: string, mimeType: string): {
    name: string;
    mimeType: string;
} {
    const normalizedName = name
        .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
        .trim()
        .slice(0, MAX_ATTACHMENT_METADATA_LENGTH);
    const normalizedMimeType = mimeType
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .toLowerCase()
        .slice(0, MAX_ATTACHMENT_METADATA_LENGTH);
    return {
        name: normalizedName || 'attachment',
        mimeType: normalizedMimeType || 'application/octet-stream',
    };
}

export function attachmentArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, attachmentArrayBuffer(bytes)));
    return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function encryptAttachmentBytes(plaintext: Uint8Array): Promise<{
    ciphertext: Uint8Array;
    key: string;
    nonce: string;
    plaintextSha256: string;
}> {
    await sodium.ready;
    const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
    return {
        ciphertext,
        key: encodeBase64(key, 'base64url'),
        nonce: encodeBase64(nonce, 'base64url'),
        plaintextSha256: await sha256Hex(plaintext),
    };
}

export async function decryptAttachmentBytes(
    attachment: AttachmentContent,
    payload: Uint8Array,
): Promise<Uint8Array> {
    if (attachment.v === 1) return payload;
    if (payload.length !== attachment.encryption.ciphertextSize) {
        throw new Error('Attachment ciphertext size mismatch');
    }

    await sodium.ready;
    let plaintext: Uint8Array;
    try {
        plaintext = sodium.crypto_secretbox_open_easy(
            payload,
            decodeBase64(attachment.encryption.nonce, 'base64url'),
            decodeBase64(attachment.encryption.key, 'base64url'),
        );
    } catch {
        throw new Error('Attachment authentication failed');
    }

    if (plaintext.length !== attachment.size) {
        throw new Error('Attachment plaintext size mismatch');
    }
    if (await sha256Hex(plaintext) !== attachment.encryption.plaintextSha256) {
        throw new Error('Attachment digest mismatch');
    }
    return plaintext;
}
