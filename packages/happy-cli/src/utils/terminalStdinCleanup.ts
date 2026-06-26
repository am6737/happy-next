/**
 * Helpers used to safely hand stdin back from an Ink-driven UI (e.g. the
 * remote-mode display) to the next interactive child process (e.g. local
 * `claude` running with stdio: 'inherit').
 *
 * Two failure modes we are guarding against on the remote→local switch:
 *
 *  1. Bytes that landed in stdin's read buffer while Ink owned it (extra
 *     spaces from the double-space confirmation, or anything typed during
 *     the brief "Switching to local mode…" delay) are still pending after
 *     Ink unmounts. The next process inherits the same fd and consumes
 *     them as if the user had typed them at the new prompt.
 *
 *  2. Once Ink calls setRawMode(false) on its componentWillUnmount, the
 *     terminal driver returns to cooked mode. Any keystroke that lands
 *     between Ink unmount and the child setting raw mode is *echoed by
 *     the kernel* at whatever screen position Ink last left the cursor —
 *     producing visible garbage (and what looks like a "second cursor")
 *     on top of the next process's UI.
 *
 * The cleanup keeps the terminal in raw mode for the whole drain window,
 * silently consumes any pending bytes, then pauses stdin. When handing off
 * to another raw-mode consumer (claude code) we leave raw mode enabled so
 * there is no cooked-mode race window; when the process is exiting instead
 * we restore cooked mode via leaveRawMode: false so the user's shell stays
 * usable. Passing drainMs: 0 skips the drain entirely (the exit path).
 *
 * NOTE: this only normalises stdin state. The other half of a clean handoff
 * lives in claudeLocal, which forces the inherited fd back into blocking I/O
 * (setBlocking) before spawning the child — without it the child can read
 * partial/empty bytes (EAGAIN), which is what corrupts CJK/IME cursors.
 */

/** Run a best-effort stdin operation; failures here are benign (stdin may be paused/destroyed). */
function safe(fn: () => void): void {
    try {
        fn();
    } catch {
        // ignore
    }
}

export async function cleanupStdinAfterInk(opts: {
    stdin: {
        isTTY?: boolean;
        on: (event: 'data', listener: (chunk: unknown) => void) => unknown;
        off: (event: 'data', listener: (chunk: unknown) => void) => unknown;
        resume: () => void;
        pause: () => void;
        setRawMode?: (value: boolean) => void;
    };
    /**
     * Drain buffered input for this many ms. The terminal stays in raw mode
     * for this window so the kernel does not echo any keystrokes that arrive.
     * Pass 0 to skip the drain entirely (e.g. on the exit path).
     */
    drainMs?: number;
    /**
     * If true (default), leave the terminal in raw mode after the drain.
     * The caller should immediately hand stdin to a process that itself
     * uses raw mode (e.g. claude code via stdio: 'inherit'). When false,
     * raw mode is restored to cooked at the end — use only when no raw-mode
     * consumer follows (e.g. the process is about to exit to the shell).
     */
    leaveRawMode?: boolean;
    /**
     * Optional debug sink so callers can log how much was drained.
     */
    onDebug?: (event: { bytes: number; chunks: number }) => void;
}): Promise<void> {
    const stdin = opts.stdin;
    if (!stdin.isTTY) return;

    const leaveRawMode = opts.leaveRawMode ?? true;
    const drainMs = Math.max(0, opts.drainMs ?? 0);

    let bytes = 0;
    let chunks = 0;

    if (drainMs > 0) {
        // Re-assert raw mode for the drain window. Ink's unmount turns it off
        // before we get here, so without this the kernel echoes pending or
        // arriving keystrokes to the screen.
        safe(() => stdin.setRawMode?.(true));

        const drainListener = (chunk: unknown) => {
            chunks++;
            if (typeof chunk === 'string') {
                bytes += Buffer.byteLength(chunk);
            } else if (chunk && typeof (chunk as Buffer).length === 'number') {
                bytes += (chunk as Buffer).length;
            }
        };

        try {
            stdin.on('data', drainListener);
            stdin.resume();
            await new Promise<void>((resolve) => setTimeout(resolve, drainMs));
        } finally {
            safe(() => stdin.off('data', drainListener));
        }
    }

    safe(() => stdin.pause());
    if (!leaveRawMode) {
        safe(() => stdin.setRawMode?.(false));
    }
    opts.onDebug?.({ bytes, chunks });
}
