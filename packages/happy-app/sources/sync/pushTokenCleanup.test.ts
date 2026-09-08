import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, string>();

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) {
            return values.get(key);
        }

        set(key: string, value: string) {
            values.set(key, value);
        }

        delete(key: string) {
            values.delete(key);
        }
    },
}));

import { PushTokenRegistrationGate } from './pushTokenRegistrationGate';

import { cleanupSupersededPushTokens } from './pushTokenCleanup';

describe('push token cleanup', () => {
    beforeEach(() => values.clear());
    afterEach(() => vi.useRealTimers());

    it('retries a failed deletion on the next activation', async () => {
        const deleteToken = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(undefined);

        const firstAttempt = await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'new-token',
            replacedTokens: ['old-token'],
            deleteToken,
        });
        expect(firstAttempt).toEqual([
            expect.objectContaining({ token: 'old-token', status: 'failed' }),
        ]);

        const retry = await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'new-token',
            replacedTokens: [],
            deleteToken,
        });
        expect(retry).toEqual([{ token: 'old-token', status: 'removed' }]);
        expect(deleteToken).toHaveBeenCalledTimes(2);

        await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'new-token',
            replacedTokens: [],
            deleteToken,
        });
        expect(deleteToken).toHaveBeenCalledTimes(2);
    });

    it('keeps pending cleanup isolated by server and account', async () => {
        const deleteToken = vi.fn().mockRejectedValue(new Error('offline'));
        await cleanupSupersededPushTokens({
            scope: 'server-a|account-a',
            currentToken: 'new-token',
            replacedTokens: ['old-token'],
            deleteToken,
        });

        deleteToken.mockClear();
        await cleanupSupersededPushTokens({
            scope: 'server-b|account-a',
            currentToken: 'new-token',
            replacedTokens: [],
            deleteToken,
        });
        expect(deleteToken).not.toHaveBeenCalled();
    });

    it('never deletes the current token', async () => {
        const deleteToken = vi.fn().mockResolvedValue(undefined);
        await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'current-token',
            replacedTokens: ['current-token'],
            deleteToken,
        });
        expect(deleteToken).not.toHaveBeenCalled();
    });
    it('bounds a whole batch and lets logout stop even when deletion ignores abort', async () => {
        vi.useFakeTimers();
        let resolveLate!: () => void;
        const deleteToken = vi.fn((_token: string, _signal: AbortSignal) => new Promise<void>((resolve) => {
            resolveLate = resolve;
        }));
        const gate = new PushTokenRegistrationGate();
        const registration = gate.run(async (_signal, startMutation) => {
            expect(startMutation()).toBe(true);
            await cleanupSupersededPushTokens({
                scope: 'server|account', currentToken: 'new-token',
                replacedTokens: ['old-a', 'old-b'], deleteToken,
            });
        });
        const stopped = vi.fn();
        const stopping = gate.stop().then(stopped);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(stopped).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await stopping;
        await registration;
        expect(stopped).toHaveBeenCalledOnce();
        expect(deleteToken).toHaveBeenCalledOnce();
        expect(deleteToken.mock.calls[0][1].aborted).toBe(true);
        expect(JSON.parse(values.get('pending:server|account')!)).toEqual(['old-a', 'old-b']);

        resolveLate();
        await vi.runAllTimersAsync();
        expect(deleteToken).toHaveBeenCalledOnce();
        expect(JSON.parse(values.get('pending:server|account')!)).toEqual(['old-a', 'old-b']);

        const retry = vi.fn().mockResolvedValue(undefined);
        await cleanupSupersededPushTokens({
            scope: 'server|account', currentToken: 'new-token', replacedTokens: [], deleteToken: retry,
        });
        expect(retry.mock.calls.map(([token]) => token)).toEqual(['old-a', 'old-b']);
        expect(values.has('pending:server|account')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('shares the deadline across tokens and retains only unfinished cleanup', async () => {
        vi.useFakeTimers();
        const deleteToken = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 2_000)))
            .mockImplementationOnce(() => new Promise(() => {}));
        const cleanup = cleanupSupersededPushTokens({
            scope: 'server|account', currentToken: 'new-token',
            replacedTokens: ['old-a', 'old-b', 'old-c'], deleteToken,
        });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(await cleanup).toEqual([
            { token: 'old-a', status: 'removed' },
            expect.objectContaining({ token: 'old-b', status: 'failed' }),
        ]);
        expect(deleteToken).toHaveBeenCalledTimes(2);
        expect(JSON.parse(values.get('pending:server|account')!)).toEqual(['old-b', 'old-c']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('consumes deletion failures that arrive after the deadline', async () => {
        vi.useFakeTimers();
        let rejectLate!: (error: Error) => void;
        const cleanup = cleanupSupersededPushTokens({
            scope: 'server|account', currentToken: 'new-token', replacedTokens: ['old'],
            deleteToken: () => new Promise((_resolve, reject) => { rejectLate = reject; }),
        });
        await vi.advanceTimersByTimeAsync(3_000);
        await cleanup;
        rejectLate(new Error('late failure'));
        await vi.runAllTimersAsync();
        expect(JSON.parse(values.get('pending:server|account')!)).toEqual(['old']);
    });

});
