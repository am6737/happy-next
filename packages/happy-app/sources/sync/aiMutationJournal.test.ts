import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
} }));
vi.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
    randomUUID: () => crypto.randomUUID(),
}));
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.example' }));
import { withAiMutationIdentity } from './aiMutationJournal';

const auth = { token: 'test-token', secret: 'test-secret' };
beforeEach(() => { storage.clear(); });

describe('AI mutation recovery', () => {
    it('reuses a persisted ID after a lost response, and creates a new intent after acknowledgement', async () => {
        const ids: string[] = [];
        await expect(withAiMutationIdentity(auth, 'chat:one', { text: 'build' }, async (id) => {
            ids.push(id);
            throw new Error('Response lost after server commit');
        })).rejects.toThrow('Response lost');
        expect(storage.size).toBe(1);
        expect([...storage.keys()][0]).not.toContain(auth.token);
        await withAiMutationIdentity({ ...auth, token: 'rotated-token' }, 'chat:one', { text: 'build' }, async (id) => { ids.push(id); });
        expect(ids[1]).toBe(ids[0]);
        expect(storage.size).toBe(0);
        await withAiMutationIdentity(auth, 'chat:one', { text: 'build' }, async (id) => { ids.push(id); });
        expect(ids[2]).not.toBe(ids[0]);
    });

    it('coalesces concurrent retries without conflating accounts or conversations', async () => {
        let resolve!: () => void;
        const gate = new Promise<void>((r) => { resolve = r; });
        const send = vi.fn(async () => { await gate; return 'ack'; });
        const first = withAiMutationIdentity(auth, 'chat:one', 'hello', send);
        const second = withAiMutationIdentity(auth, 'chat:one', 'hello', send);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        await withAiMutationIdentity({ token: 'another-account', secret: 'another-secret' }, 'chat:one', 'hello', async () => 'other');
        await withAiMutationIdentity(auth, 'chat:two', 'hello', async () => 'other');
        resolve();
        expect(await Promise.all([first, second])).toEqual(['ack', 'ack']);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
