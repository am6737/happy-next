import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const sodium = createRequire(import.meta.url)('libsodium-wrappers');
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { Encryption } from './encryption/encryption';
import { AES256Encryption } from './encryption/encryptor';
import { decryptChannelMessage, encryptChannelMessage, generateChannelKey, unwrapChannelKey, wrapChannelKeyForAccount, wrapChannelKeyForTeammate } from './channelEncryption';

// Use the real web AES adapter used by rn-encryption, rather than mocking encryption.
vi.mock('rn-encryption', async () => await import('web-secure-encryption'));
vi.mock('@/encryption/libsodium.lib', async () => ({ default: (await import('node:module')).createRequire(import.meta.url)('libsodium-wrappers') }));
vi.mock('expo-crypto', async () => {
    const crypto = await import('node:crypto');
    return { getRandomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)), randomUUID: crypto.randomUUID,
        CryptoDigestAlgorithm: { SHA512: 'SHA512' },
        digest: async (_algorithm: string, data: Uint8Array) => new Uint8Array(crypto.createHash('sha512').update(data).digest()).buffer };
});
beforeAll(async () => { await sodium.ready; });

// Independent implementation of happy-cli/src/api/encryption.ts encryptWithDataKey.
function cliEncryptFixture(value: unknown, key: Uint8Array): Uint8Array {
    const nonce = Buffer.alloc(12, 7);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    return new Uint8Array(Buffer.concat([Buffer.from([0]), nonce, cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]));
}
function cliDecrypt(bundle: Uint8Array, key: Uint8Array): unknown {
    expect(bundle[0]).toBe(0);
    const decipher = createDecipheriv('aes-256-gcm', key, bundle.slice(1, 13));
    decipher.setAuthTag(bundle.slice(-16));
    return JSON.parse(Buffer.concat([decipher.update(bundle.slice(13, -16)), decipher.final()]).toString('utf8'));
}
describe('channel encryption', () => {
    it('wraps for the real account keypair and round trips Unicode decisions/reports', async () => {
        const account = await Encryption.create(new Uint8Array(randomBytes(32)));
        const key = generateChannelKey();
        expect(key).toHaveLength(32);
        expect(generateChannelKey()).not.toEqual(key);
        const wrapped = wrapChannelKeyForAccount(key, account.contentDataKey);
        expect(decodeBase64(wrapped)[0]).toBe(0);
        expect(await account.decryptEncryptionKey(wrapped)).toEqual(key);
        const opened = await unwrapChannelKey(account, wrapped);
        const body = { text: '## 完成 🤝\n**verified**\nNeeds attention', options: [{ id: 'yes', label: '继续 🚀' }], links: [{ kind: 'session' as const, sessionId: 's' }] };
        const content = await encryptChannelMessage(opened, body);
        expect(content.t).toBe('encrypted');
        expect(content.c).not.toContain(body.text);
        expect(await decryptChannelMessage(opened, content)).toEqual(body);
        expect(cliDecrypt(decodeBase64(content.c), key)).toEqual(body);
    });
    it('uses the machine key opened from Machine.dataEncryptionKey and produces a daemon-compatible member wrap', async () => {
        const account = await Encryption.create(new Uint8Array(randomBytes(32)));
        const daemonMachineKey = new Uint8Array(randomBytes(32));
        // A daemon registers Machine.dataEncryptionKey with this exact account box format.
        const machineDataEncryptionKey = wrapChannelKeyForAccount(daemonMachineKey, account.contentDataKey);
        const appMachineKey = await account.decryptEncryptionKey(machineDataEncryptionKey);
        expect(appMachineKey).toEqual(daemonMachineKey);
        const key = generateChannelKey();
        const wrapped = await wrapChannelKeyForTeammate(key, appMachineKey!);
        expect(cliDecrypt(decodeBase64(wrapped), daemonMachineKey)).toEqual({ k: encodeBase64(key) });
        const fixture = cliEncryptFixture({ k: encodeBase64(key) }, daemonMachineKey);
        expect(await new AES256Encryption(appMachineKey!).decrypt([fixture])).toEqual([{ k: encodeBase64(key) }]);
    });
    it('decrypts a CLI-produced message fixture', async () => {
        const key = generateChannelKey();
        const body = { text: '来自 CLI 的消息 🧑‍💻', links: [{ kind: 'pr', url: 'https://example.com/pr/1' }] };
        expect(await decryptChannelMessage(key, { t: 'encrypted', c: encodeBase64(cliEncryptFixture(body, key)) })).toEqual(body);
    });
    it('rejects tampering, the wrong key, malformed bodies and unsupported versions', async () => {
        const key = generateChannelKey();
        const encrypted = await encryptChannelMessage(key, { text: 'hello' });
        expect(await decryptChannelMessage(generateChannelKey(), encrypted)).toBeNull();
        const bytes = decodeBase64(encrypted.c); bytes[bytes.length - 1] ^= 1;
        expect(await decryptChannelMessage(key, { t: 'encrypted', c: encodeBase64(bytes) })).toBeNull();
        bytes[0] = 1;
        expect(await decryptChannelMessage(key, { t: 'encrypted', c: encodeBase64(bytes) })).toBeNull();
        expect(await decryptChannelMessage(key, { t: 'encrypted', c: encodeBase64(cliEncryptFixture({ text: 42 }, key)) })).toBeNull();
        expect(await decryptChannelMessage(key, { t: 'encrypted', c: 'not base64!' })).toBeNull();
    });
    it('rejects invalid account and machine keys', async () => {
        await expect(unwrapChannelKey({ decryptEncryptionKey: async () => null }, 'bad')).rejects.toThrow();
        await expect(wrapChannelKeyForTeammate(generateChannelKey(), new Uint8Array(16))).rejects.toThrow();
    });
});
