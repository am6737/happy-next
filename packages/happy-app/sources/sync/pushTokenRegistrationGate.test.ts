import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushTokenRegistrationGate } from './pushTokenRegistrationGate';

describe('PushTokenRegistrationGate', () => {
    afterEach(() => vi.useRealTimers());

    it('stops immediately when token lookup ignores abort, without any timeout', async () => {
        vi.useFakeTimers();
        const gate = new PushTokenRegistrationGate();
        let release!: () => void;
        const task = vi.fn((_signal: AbortSignal) => new Promise<void>((resolve) => {
            release = resolve;
        }));
        const registration = gate.run(task);
        // Intentionally do not advance timers or resolve the lookup before stop.
        await gate.stop();
        await gate.stop();
        expect(task.mock.calls[0][0].aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        release();
        await registration;
    });

    it('does not start registrations after it has stopped', async () => {
        const gate = new PushTokenRegistrationGate();
        const task = vi.fn().mockResolvedValue(undefined);
        await gate.stop();
        await gate.run(task);
        expect(task).not.toHaveBeenCalled();
    });

    it('prevents a late lookup from binding after logout cleanup or a new login', async () => {
        const gate = new PushTokenRegistrationGate();
        let release!: () => void;
        const oldBinding = vi.fn();
        const registration = gate.run(async (_signal, startMutation) => {
            await new Promise<void>((resolve) => { release = resolve; });
            if (startMutation()) oldBinding();
        });
        await gate.stop();
        const deleteToken = vi.fn().mockResolvedValue(undefined);
        await deleteToken();
        // Resuming registration uses a new gate. An old task must stay stopped.
        const newGate = new PushTokenRegistrationGate();
        const newBinding = vi.fn();
        await newGate.run(async (_signal, startMutation) => {
            if (startMutation()) newBinding();
        });
        release();
        await registration;
        expect(oldBinding).not.toHaveBeenCalled();
        expect(newBinding).toHaveBeenCalledOnce();
    });

    it('rejects an attempted binding synchronously from an abort callback', async () => {
        const gate = new PushTokenRegistrationGate();
        const bind = vi.fn();
        const registration = gate.run((signal, startMutation) => new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
                if (startMutation()) bind();
                resolve();
            }, { once: true });
        }));
        await gate.stop();
        await registration;
        expect(bind).not.toHaveBeenCalled();
    });

    it('preserves late acquisition errors without delaying stop', async () => {
        const gate = new PushTokenRegistrationGate();
        let reject!: (error: Error) => void;
        const result = gate.run(() => new Promise<void>((_resolve, fail) => { reject = fail; }))
            .catch((error: Error) => error);
        await gate.stop();
        const error = new Error('late acquisition failure');
        reject(error);
        expect(await result).toBe(error);
    });

    it.each(['resolve', 'reject'] as const)(
        'waits for an active server binding to %s before allowing deletion', async (outcome) => {
            vi.useFakeTimers();
            const gate = new PushTokenRegistrationGate();
            let resolve!: () => void;
            let reject!: (error: Error) => void;
            let bindingSignal!: AbortSignal;
            const registration = gate.run(async (signal, startMutation) => {
                bindingSignal = signal;
                expect(startMutation()).toBe(true);
                await new Promise<void>((done, fail) => { resolve = done; reject = fail; });
                // Stopping must also prevent any subsequent compatibility binding.
                expect(startMutation()).toBe(false);
            }).catch((error: Error) => error);
            const deleteToken = vi.fn();
            const stopping = gate.stop().then(deleteToken);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(deleteToken).not.toHaveBeenCalled();
            expect(bindingSignal.aborted).toBe(false);
            if (outcome === 'resolve') resolve();
            else reject(new Error('binding failed'));
            await stopping;
            if (outcome === 'resolve') {
                await expect(registration).resolves.toBeUndefined();
            } else {
                await expect(registration).resolves.toEqual(new Error('binding failed'));
            }
            expect(deleteToken).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});
