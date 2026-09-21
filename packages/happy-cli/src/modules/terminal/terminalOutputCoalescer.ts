/**
 * Batches terminal output before it goes on the wire.
 *
 * A busy command emits many small chunks (a spinner repaints ~10x/s, a build
 * log floods). Sending each one as its own message costs a socket round trip
 * and an encrypt/decrypt per chunk on both sides. Batching on a short timer
 * collapses them without adding perceptible latency.
 *
 * Two rules matter for feel:
 *  - Leading edge: when nothing is pending, send immediately, so a keystroke
 *    echo never waits a full interval.
 *  - Hard caps: a timer alone lets a `yes`-style flood grow the buffer without
 *    bound, so flush early once a byte or character threshold is crossed.
 */

export interface TerminalOutputCoalescerOptions {
    /** Milliseconds to hold non-leading output before flushing. */
    flushDelayMs?: number;
    /** Flush early once this many bytes are pending. */
    maxBytes?: number;
    /** Flush early once this many characters are pending. */
    maxChars?: number;
    onFlush: (data: string) => void;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    now?: () => number;
}

const DEFAULT_FLUSH_DELAY_MS = 8;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_CHARS = 32 * 1024;

export class TerminalOutputCoalescer {
    private readonly flushDelayMs: number;
    private readonly maxBytes: number;
    private readonly maxChars: number;
    private readonly onFlush: (data: string) => void;
    private readonly setTimer: typeof setTimeout;
    private readonly clearTimer: typeof clearTimeout;
    private readonly now: () => number;

    private chunks: string[] = [];
    private bytes = 0;
    private chars = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastFlushAt: number | null = null;
    private closed = false;

    constructor(options: TerminalOutputCoalescerOptions) {
        this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
        this.onFlush = options.onFlush;
        this.setTimer = options.setTimeout ?? setTimeout;
        this.clearTimer = options.clearTimeout ?? clearTimeout;
        this.now = options.now ?? Date.now;
    }

    handle(data: string): void {
        if (this.closed || data.length === 0) {
            return;
        }

        this.chunks.push(data);
        this.chars += data.length;
        // Terminal output is overwhelmingly ASCII; counting UTF-16 units is a
        // deliberate approximation. The cap only needs to bound memory, and the
        // exact byte count is unknowable without encoding every chunk.
        this.bytes += data.length;

        if (this.bytes >= this.maxBytes || this.chars >= this.maxChars) {
            this.flush();
            return;
        }

        const sinceLastFlush = this.lastFlushAt === null ? Number.POSITIVE_INFINITY : this.now() - this.lastFlushAt;
        if (this.timer === null && sinceLastFlush >= this.flushDelayMs) {
            // Leading edge — nothing pending and the previous flush is old
            // enough that waiting again would be visible.
            this.flush();
            return;
        }

        if (this.timer === null) {
            this.timer = this.setTimer(() => {
                this.timer = null;
                this.flush();
            }, this.flushDelayMs);
        }
    }

    /** Emits anything pending. Safe to call when the buffer is empty. */
    flush(): void {
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        if (this.chunks.length === 0) {
            return;
        }

        const data = this.chunks.join('');
        this.chunks = [];
        this.bytes = 0;
        this.chars = 0;
        this.lastFlushAt = this.now();
        this.onFlush(data);
    }

    /** Flushes and stops accepting input. */
    close(): void {
        this.flush();
        this.closed = true;
    }
}
