import { describe, expect, it, vi } from 'vitest';
import { TerminalOutputCoalescer } from './terminalOutputCoalescer';

/** Controllable timers so batching can be stepped without real delays. */
function createTimers() {
    let now = 0;
    const scheduled: Array<{ id: number; fn: () => void; at: number }> = [];
    let nextId = 1;

    return {
        timers: {
            setTimeout: ((fn: () => void, delay?: number) => {
                const id = nextId++;
                scheduled.push({ id, fn, at: now + (delay ?? 0) });
                return id as unknown as ReturnType<typeof setTimeout>;
            }) as unknown as typeof setTimeout,
            clearTimeout: ((id: unknown) => {
                const index = scheduled.findIndex((entry) => entry.id === id);
                if (index >= 0) {
                    scheduled.splice(index, 1);
                }
            }) as unknown as typeof clearTimeout,
        },
        now: () => now,
        advance(ms: number) {
            now += ms;
            const due = scheduled.filter((entry) => entry.at <= now);
            for (const entry of due) {
                scheduled.splice(scheduled.indexOf(entry), 1);
                entry.fn();
            }
        },
        pending: () => scheduled.length,
    };
}

describe('TerminalOutputCoalescer', () => {
    it('flushes immediately when nothing was flushed recently (leading edge)', () => {
        const clock = createTimers();
        const flushed: string[] = [];
        const coalescer = new TerminalOutputCoalescer({
            onFlush: (data) => flushed.push(data),
            ...clock.timers,
            now: clock.now,
        });

        coalescer.handle('hello');

        // No timer should be pending: this is the echo path, where a delay is felt.
        expect(flushed).toEqual(['hello']);
        expect(clock.pending()).toBe(0);
    });

    it('batches bursts that arrive within the flush window', () => {
        const clock = createTimers();
        const flushed: string[] = [];
        const coalescer = new TerminalOutputCoalescer({
            flushDelayMs: 8,
            onFlush: (data) => flushed.push(data),
            ...clock.timers,
            now: clock.now,
        });

        coalescer.handle('a');
        // Leading edge fired for 'a'; subsequent chunks within the window wait.
        clock.advance(1);
        coalescer.handle('b');
        coalescer.handle('c');

        expect(flushed).toEqual(['a']);
        expect(clock.pending()).toBe(1);

        clock.advance(8);
        expect(flushed).toEqual(['a', 'bc']);
    });

    it('flushes early once the byte cap is crossed', () => {
        const clock = createTimers();
        const flushed: string[] = [];
        const coalescer = new TerminalOutputCoalescer({
            flushDelayMs: 1000,
            maxBytes: 10,
            onFlush: (data) => flushed.push(data),
            ...clock.timers,
            now: clock.now,
        });

        coalescer.handle('12345');
        coalescer.handle('67890');
        coalescer.handle('overflow');

        expect(flushed.join('')).toBe('1234567890overflow');
    });

    it('flushes and stops accepting input after close', () => {
        const clock = createTimers();
        const flushed: string[] = [];
        const coalescer = new TerminalOutputCoalescer({
            flushDelayMs: 8,
            onFlush: (data) => flushed.push(data),
            ...clock.timers,
            now: clock.now,
        });

        coalescer.handle('x');
        clock.advance(1);
        coalescer.handle('pending');
        coalescer.close();
        coalescer.handle('after-close');

        expect(flushed).toEqual(['x', 'pending']);
    });

    it('flushes pending output when closed with a timer still armed', () => {
        const clock = createTimers();
        const onFlush = vi.fn();
        const coalescer = new TerminalOutputCoalescer({
            flushDelayMs: 8,
            onFlush,
            ...clock.timers,
            now: clock.now,
        });

        coalescer.handle('first');
        clock.advance(1);
        coalescer.handle('second');
        expect(clock.pending()).toBe(1);

        coalescer.close();

        expect(onFlush).toHaveBeenCalledTimes(2);
        expect(onFlush).toHaveBeenLastCalledWith('second');
        expect(clock.pending()).toBe(0);
    });

    it('ignores empty chunks', () => {
        const clock = createTimers();
        const onFlush = vi.fn();
        const coalescer = new TerminalOutputCoalescer({
            onFlush,
            ...clock.timers,
            now: clock.now,
        });

        coalescer.handle('');
        expect(onFlush).not.toHaveBeenCalled();
    });
});
