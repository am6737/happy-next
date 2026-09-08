import { MMKV } from 'react-native-mmkv';
import { getSupersededPushTokens } from './pushTokenMigration';

const CLEANUP_TIMEOUT_MS = 3_000;

const cleanupStorage = new MMKV({ id: 'push-token-cleanup' });

function getCleanupKey(scope: string): string {
    return `pending:${scope}`;
}

function readPendingTokens(scope: string): string[] {
    const value = cleanupStorage.getString(getCleanupKey(scope));
    if (!value) {
        return [];
    }

    try {
        const tokens = JSON.parse(value) as unknown;
        if (!Array.isArray(tokens)) {
            return [];
        }
        return [...new Set(tokens.filter(
            (token): token is string => typeof token === 'string' && token.length > 0,
        ))];
    } catch {
        return [];
    }
}

function writePendingTokens(scope: string, tokens: Iterable<string>): void {
    const values = [...new Set(tokens)];
    const key = getCleanupKey(scope);
    if (values.length === 0) {
        cleanupStorage.delete(key);
        return;
    }
    cleanupStorage.set(key, JSON.stringify(values));
}

export interface PushTokenCleanupResult {
    token: string;
    status: 'removed' | 'failed';
    error?: unknown;
}

export async function cleanupSupersededPushTokens(options: {
    scope: string;
    currentToken: string;
    replacedTokens: Array<string | null | undefined>;
    deleteToken: (token: string, signal: AbortSignal) => Promise<void>;
}): Promise<PushTokenCleanupResult[]> {
    const pendingTokens = new Set([
        ...readPendingTokens(options.scope),
        ...getSupersededPushTokens(options.currentToken, options.replacedTokens),
    ]);

    // A provider may eventually reuse a token that was pending cleanup.
    pendingTokens.delete(options.currentToken);
    writePendingTokens(options.scope, pendingTokens);

    const results: PushTokenCleanupResult[] = [];
    if (pendingTokens.size === 0) {
        return results;
    }

    // Bound the whole batch, not each token: a backlog must not multiply the
    // amount of time logout waits for the registration mutation to finish.
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error('Timed out while cleaning up superseded push tokens'));
            controller.abort();
        }, CLEANUP_TIMEOUT_MS);
    });
    try {
        for (const token of pendingTokens) {
            try {
                await Promise.race([options.deleteToken(token, controller.signal), deadline]);
                pendingTokens.delete(token);
                writePendingTokens(options.scope, pendingTokens);
                results.push({ token, status: 'removed' });
            } catch (error) {
                results.push({ token, status: 'failed', error });
            }
            // Leave this token (if failed) and all unattempted tokens persisted
            // for the next activation. Late responses cannot mutate that state.
            if (controller.signal.aborted) {
                break;
            }
        }
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
    return results;
}
