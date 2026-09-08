import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExpoCompatibilityToken } from './expoCompatibilityToken';
import { PushTokenRegistrationGate } from './pushTokenRegistrationGate';

describe('getExpoCompatibilityToken', () => {
    afterEach(() => vi.useRealTimers());

    it('returns the token and clears its timer on success', async () => {
        vi.useFakeTimers();
        await expect(getExpoCompatibilityToken(async () => ({ data: 'expo-token' })))
            .resolves.toBe('expo-token');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates acquisition errors and clears its timer', async () => {
        vi.useFakeTimers();
        await expect(getExpoCompatibilityToken(async () => { throw new Error('offline'); }))
            .rejects.toThrow('offline');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('times out a hung acquisition even without logout', async () => {
        vi.useFakeTimers();
        const token = getExpoCompatibilityToken(() => new Promise(() => {}));
        await vi.advanceTimersByTimeAsync(3_000);
        await expect(token).resolves.toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['before timeout', 'after timeout'] as const)(
        'finishes stopping without binding a token that arrives %s', async (arrival) => {
            vi.useFakeTimers();
            const gate = new PushTokenRegistrationGate();
            let release!: (value: { data: string }) => void;
            const bind = vi.fn();
            const registration = gate.run(async (_signal, startMutation) => {
                // Simulate a completed DooPush binding before acquiring the optional token.
                expect(startMutation()).toBe(true);
                const token = await getExpoCompatibilityToken(() => new Promise((resolve) => {
                    release = resolve;
                }));
                if (token !== null && startMutation()) {
                    bind(token);
                }
            });
            const stopped = vi.fn();
            const stopping = gate.stop().then(stopped);
            if (arrival === 'before timeout') {
                release({ data: 'late-token' });
            }
            await vi.advanceTimersByTimeAsync(3_000);
            expect(stopped).toHaveBeenCalledOnce();
            release({ data: 'late-token' });
            await registration;
            await stopping;
            expect(bind).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('safely consumes an acquisition rejection after timeout', async () => {
        vi.useFakeTimers();
        let reject!: (error: Error) => void;
        const token = getExpoCompatibilityToken(() => new Promise((_resolve, rejectToken) => {
            reject = rejectToken;
        }));
        await vi.advanceTimersByTimeAsync(3_000);
        await expect(token).resolves.toBeNull();
        reject(new Error('late network failure'));
        await vi.runAllTimersAsync();
    });
});
