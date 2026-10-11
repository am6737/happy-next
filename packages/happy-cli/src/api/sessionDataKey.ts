import { readFile } from 'node:fs/promises';
import { decodeBase64, encodeBase64, getRandomBytes } from './encryption';

/** Select a daemon-provided key, or generate a fresh key for a normal session. */
export async function resolveSessionDataKey(): Promise<Uint8Array> {
    const path = process.env.HAPPY_SESSION_DATA_KEY_FILE;
    if (path === undefined) return getRandomBytes(32);

    return readSessionDataKeyFile(path);
}

/** Read a canonical daemon-held key without changing process environment. */
export async function readSessionDataKeyFile(path: string): Promise<Uint8Array> {
    let encoded: string;
    try {
        encoded = (await readFile(path, 'utf8')).trim();
    } catch (error) {
        throw new Error(`Cannot read HAPPY_SESSION_DATA_KEY_FILE at "${path}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    // Buffer's base64 decoder accepts malformed input; require canonical encoding.
    const key = decodeBase64(encoded);
    if (!encoded || encodeBase64(key) !== encoded) {
        throw new Error(`Invalid HAPPY_SESSION_DATA_KEY_FILE at "${path}": expected standard padded base64 encoding of a 32-byte key`);
    }
    if (key.length !== 32) {
        throw new Error(`Invalid HAPPY_SESSION_DATA_KEY_FILE at "${path}": expected exactly 32 bytes, got ${key.length}`);
    }
    return key;
}
