import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import { ApiClient } from './api';
import { decodeBase64, decrypt, getRandomBytes } from './encryption';
import { resolveSessionDataKey } from './sessionDataKey';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('axios', () => ({ default: { post: mockPost, isAxiosError: () => false } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/configuration', () => ({ configuration: { serverUrl: 'https://api.example.test' } }));
vi.mock('./apiSession', () => ({ ApiSessionClient: vi.fn() }));
vi.mock('./apiMachine', () => ({ ApiMachineClient: vi.fn() }));

describe('session data key selection', () => {
    let dir: string;
    let path: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'happy-session-key-'));
        path = join(dir, 'session.key');
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', undefined);
        mockPost.mockReset();
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(dir, { recursive: true, force: true });
    });

    it('uses the base64 key from the environment-selected file', async () => {
        const key = new Uint8Array(32).fill(42);
        await writeFile(path, `${Buffer.from(key).toString('base64')}\n`);
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', path);
        expect(await resolveSessionDataKey()).toEqual(key);
    });

    it.each([0, 31, 33])('rejects a %i-byte key', async length => {
        await writeFile(path, Buffer.alloc(length).toString('base64'));
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', path);
        await expect(resolveSessionDataKey()).rejects.toThrow(/HAPPY_SESSION_DATA_KEY_FILE.*32.byte/);
    });

    it('rejects malformed base64 even when the permissive decoder would produce 32 bytes', async () => {
        await writeFile(path, `${Buffer.alloc(32).toString('base64')}!`);
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', path);
        await expect(resolveSessionDataKey()).rejects.toThrow('expected standard padded base64');
    });

    it('throws a clear error for an unreadable file rather than generating a key', async () => {
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', path);
        await expect(resolveSessionDataKey()).rejects.toThrow('Cannot read HAPPY_SESSION_DATA_KEY_FILE');
    });

    it('treats an explicitly empty path as an error', async () => {
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', '');
        await expect(resolveSessionDataKey()).rejects.toThrow('Cannot read HAPPY_SESSION_DATA_KEY_FILE');
    });

    it('generates fresh random 32-byte keys when the env var is unset', async () => {
        const first = await resolveSessionDataKey();
        const second = await resolveSessionDataKey();
        expect(first).toBeInstanceOf(Uint8Array);
        expect(first).toHaveLength(32);
        expect(second).toHaveLength(32);
        expect(first).not.toEqual(second);
    });

    it('wraps the provided session key for the account and uses it for session metadata', async () => {
        const key = new Uint8Array(32).fill(42);
        await writeFile(path, Buffer.from(key).toString('base64'));
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', path);
        const account = tweetnacl.box.keyPair();
        const client = await ApiClient.create({
            token: 'test-token',
            encryption: { type: 'dataKey', publicKey: account.publicKey, machineKey: getRandomBytes(32) },
        });
        const metadata = {
            path: dir, host: 'test-host', homeDir: dir, happyHomeDir: dir, happyLibDir: dir, happyToolsDir: dir,
        };
        mockPost.mockImplementation(async (_url, body) => ({
            data: { session: { id: 'session-1', seq: 0, metadata: body.metadata, metadataVersion: 0, agentState: null, agentStateVersion: 0 } },
        }));
        const session = await client.getOrCreateSession({ tag: 'test-session', metadata, state: null });
        expect(session?.encryptionKey).toEqual(key);
        expect(session?.metadata).toEqual(metadata);
        const body = mockPost.mock.calls[0][1];
        expect(decrypt(key, 'dataKey', decodeBase64(body.metadata))).toEqual(metadata);
        const wrapped = decodeBase64(body.dataEncryptionKey);
        expect(wrapped[0]).toBe(0);
        const unwrapped = tweetnacl.box.open(wrapped.slice(57), wrapped.slice(33, 57), wrapped.slice(1, 33), account.secretKey);
        expect(unwrapped).toEqual(key);
    });

    it('fails before making a session request if the configured key is unreadable', async () => {
        vi.stubEnv('HAPPY_SESSION_DATA_KEY_FILE', path);
        const client = await ApiClient.create({
            token: 'test-token',
            encryption: { type: 'dataKey', publicKey: tweetnacl.box.keyPair().publicKey, machineKey: getRandomBytes(32) },
        });
        await expect(client.getOrCreateSession({
            tag: 'test-session', state: null,
            metadata: { path: dir, host: 'test-host', homeDir: dir, happyHomeDir: dir, happyLibDir: dir, happyToolsDir: dir },
        })).rejects.toThrow('Cannot read HAPPY_SESSION_DATA_KEY_FILE');
        expect(mockPost).not.toHaveBeenCalled();
    });
});
