import { describe, it, expect, vi } from 'vitest';
import { cleanupStdinAfterInk } from './terminalStdinCleanup';

function makeFakeStdin(opts: { isTTY: boolean }) {
    const dataListeners = new Set<(chunk: unknown) => void>();
    const calls: string[] = [];
    const stdin = {
        isTTY: opts.isTTY,
        rawMode: false as boolean,
        on(event: 'data', listener: (chunk: unknown) => void) {
            if (event === 'data') dataListeners.add(listener);
            return stdin;
        },
        off(event: 'data', listener: (chunk: unknown) => void) {
            if (event === 'data') dataListeners.delete(listener);
            return stdin;
        },
        resume() { calls.push('resume'); },
        pause() { calls.push('pause'); },
        setRawMode(value: boolean) { stdin.rawMode = value; calls.push(`setRawMode:${value}`); },
        // test helper to simulate bytes arriving during the drain window
        emit(chunk: unknown) { for (const l of dataListeners) l(chunk); },
        dataListenerCount() { return dataListeners.size; },
    };
    return { stdin, calls };
}

describe('cleanupStdinAfterInk', () => {
    it('is a no-op when stdin is not a TTY', async () => {
        const { stdin, calls } = makeFakeStdin({ isTTY: false });
        await cleanupStdinAfterInk({ stdin, drainMs: 50 });
        expect(calls).toEqual([]);
    });

    it('exit path (drainMs:0, leaveRawMode:false) restores cooked mode without draining', async () => {
        const { stdin, calls } = makeFakeStdin({ isTTY: true });
        await cleanupStdinAfterInk({ stdin, drainMs: 0, leaveRawMode: false });
        // No drain: never resumes stdin or asserts raw on; just pause + cooked.
        expect(calls).toEqual(['pause', 'setRawMode:false']);
        expect(stdin.rawMode).toBe(false);
        expect(stdin.dataListenerCount()).toBe(0);
    });

    it('switch path drains buffered keystrokes and keeps raw mode on for the handoff', async () => {
        vi.useFakeTimers();
        try {
            const { stdin, calls } = makeFakeStdin({ isTTY: true });
            const onDebug = vi.fn();
            const done = cleanupStdinAfterInk({ stdin, drainMs: 150, leaveRawMode: true, onDebug });

            // Bytes that arrive during the drain window are swallowed, not leaked.
            stdin.emit('  ');                              // 2 bytes (string)
            stdin.emit(Buffer.from([0x1b, 0x5b, 0x41]));   // 3 bytes (buffer)

            await vi.advanceTimersByTimeAsync(150);
            await done;

            expect(onDebug).toHaveBeenCalledWith({ bytes: 5, chunks: 2 });
            expect(calls).toContain('setRawMode:true');    // re-asserted for the drain
            expect(calls).toContain('resume');
            expect(calls).toContain('pause');
            expect(calls).not.toContain('setRawMode:false');
            expect(stdin.rawMode).toBe(true);
            expect(stdin.dataListenerCount()).toBe(0);     // listener detached
        } finally {
            vi.useRealTimers();
        }
    });

    it('drain + leaveRawMode:false restores cooked mode after draining', async () => {
        vi.useFakeTimers();
        try {
            const { stdin } = makeFakeStdin({ isTTY: true });
            const done = cleanupStdinAfterInk({ stdin, drainMs: 150, leaveRawMode: false });
            await vi.advanceTimersByTimeAsync(150);
            await done;
            expect(stdin.rawMode).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
