import AsyncStorage from '@react-native-async-storage/async-storage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';

const active = new Map<string, Promise<unknown>>();

/** Persist an unacknowledged intent before sending it, so a lost response or
 * app restart reuses its identity. A confirmed response ends that intent. */
export async function withAiMutationIdentity<T>(
    credentials: AuthCredentials,
    scope: string,
    payload: unknown,
    send: (clientMessageId: string) => Promise<T>,
): Promise<T> {
    // Do not store tokens, account secrets or message contents in storage keys.
    const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256,
        JSON.stringify([getServerUrl(), credentials.secret, scope, payload]));
    const key = `ai-mutation-v1:${digest}`;
    const existing = active.get(key);
    if (existing) return existing as Promise<T>;
    const operation = (async () => {
        const saved = await AsyncStorage.getItem(key);
        const id = saved ?? randomUUID();
        if (!saved) await AsyncStorage.setItem(key, id);
        const result = await send(id);
        // A storage failure after acknowledgement must not look like a failed
        // server mutation. Keeping the key is safer than creating a duplicate.
        await AsyncStorage.removeItem(key).catch(() => undefined);
        return result;
    })();
    active.set(key, operation);
    try {
        return await operation;
    } finally {
        active.delete(key);
    }
}
