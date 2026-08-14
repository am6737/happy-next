import { describe, expect, it, vi } from 'vitest';
import { PushTokenRegistrationGate } from './pushTokenRegistrationGate';

describe('PushTokenRegistrationGate', () => {
    it('aborts and waits for an active registration before stopping', async () => {
        const gate = new PushTokenRegistrationGate();
        let release: (() => void) | undefined;
        const task = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
                release = resolve;
            }, { once: true });
        }));

        const registration = gate.run(task);
        const stopping = gate.stop(100);

        expect(task.mock.calls[0]?.[0].aborted).toBe(true);
        expect(release).toBeDefined();
        release?.();
        await expect(stopping).resolves.toBeUndefined();
        await expect(registration).resolves.toBeUndefined();
    });

    it('does not start registrations after it has stopped', async () => {
        const gate = new PushTokenRegistrationGate();
        const task = vi.fn().mockResolvedValue(undefined);

        await gate.stop();
        await gate.run(task);

        expect(task).not.toHaveBeenCalled();
    });

    it('does not allow a late task to mutate after stop times out', async () => {
        const gate = new PushTokenRegistrationGate();
        let release: (() => void) | undefined;
        const mutate = vi.fn();
        const registration = gate.run(async (_signal, startMutation) => {
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            if (startMutation()) {
                mutate();
            }
        });

        await gate.stop(1);
        release?.();
        await registration;

        expect(mutate).not.toHaveBeenCalled();
    });

    it('waits past the timeout when a server mutation has started', async () => {
        const gate = new PushTokenRegistrationGate();
        let release: (() => void) | undefined;
        const registration = gate.run(async (signal, startMutation) => {
            expect(startMutation()).toBe(true);
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            expect(signal.aborted).toBe(false);
        });

        let stopped = false;
        const stopping = gate.stop(1).then(() => {
            stopped = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(stopped).toBe(false);
        release?.();
        await stopping;
        await registration;
    });
});
