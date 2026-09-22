import * as React from 'react';

/**
 * How long a fold's body takes to slide shut or open.
 *
 * A fold is a tap on a line the reader is already looking at, so the motion is there to keep the
 * line and the answer in one piece while the body between them leaves — not to be watched. Much
 * longer and the reader would be waiting on their own tap.
 */
const FOLD_HEIGHT_MS = 200;

/** Cubic ease-out: the body covers most of the distance early, then settles rather than stops. */
function easeOutCubic(progress: number): number {
    const remaining = 1 - progress;
    return 1 - remaining * remaining * remaining;
}

/** Which way a fold's bodies are going. */
export type FoldDirection = 'collapsing' | 'expanding';

/** A row whose slide has finished, with the element that was drawing it. */
export type FoldSettledRow = { key: string; element: HTMLElement };

export type FoldAnimation = {
    /** Rows mid-slide. Their bodies are still mounted, clipped to the height so far. */
    animatingIds: ReadonlySet<string>;
    /**
     * Rows whose measurements must not reach the model while their height belongs to the slide — the
     * observed element's own height moves with the clip, so every frame would otherwise look like a
     * measurement. A ref because the measurement pipeline reads it as batches land, mid-frame.
     */
    suppressedKeysRef: React.RefObject<ReadonlySet<string>>;
    /** The element that clips one row's body. Stable per row, so rows keep their props. */
    clipRefFor: (key: string) => (el: HTMLElement | null) => void;
    /** Give those elements back their own height, once the model has taken the animated one. */
    releaseKeys: (rows: readonly FoldSettledRow[]) => void;
    /**
     * Begin a slide. The caller flips the fold in the same event, so one commit carries both the new
     * layout and the clip the slide runs on.
     */
    start: (args: { keys: readonly string[]; direction: FoldDirection }) => void;
    /**
     * The rows whose slide has just finished, once — each with the element it was drawing, since
     * this is the only moment either is still reachable: React detaches the row's ref in the very
     * commit that ends the slide, before the caller's layout effect gets to run.
     */
    takeSettled: () => readonly FoldSettledRow[] | null;
};

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The height animation behind a fold.
 *
 * Only heights move, and every frame writes them straight onto the DOM: the model was told what the
 * fold does to the layout when the fold itself landed (the offset absorbed it), so what is left is
 * the reader watching the body slide — and a React commit per frame would re-render the message
 * inside it for nothing. Both endpoints are the body's own height, read off the element being
 * animated, so nothing here has to know how tall a folded line is: a line, a landmark and a tool
 * call all slide the same way.
 */
export function useFoldAnimation(): FoldAnimation {
    const [transition, setTransition] = React.useState<{
        keys: readonly string[];
        direction: FoldDirection;
    } | null>(null);
    const clipElsRef = React.useRef(new Map<string, HTMLElement>());
    const clipRefsRef = React.useRef(new Map<string, (el: HTMLElement | null) => void>());
    const frameRef = React.useRef<number | null>(null);
    // Where each body is as it is being drawn, so a second tap can carry on from there instead of
    // from the height the body would have had.
    const currentPxRef = React.useRef(new Map<string, number>());
    const carryPxRef = React.useRef(new Map<string, number>());
    const suppressedKeysRef = React.useRef<ReadonlySet<string>>(NO_KEYS);
    const settledRowsRef = React.useRef<readonly FoldSettledRow[] | null>(null);

    const animatingIds = React.useMemo(
        () => (transition === null ? NO_KEYS : new Set(transition.keys)),
        [transition],
    );

    const clipRefFor = React.useCallback((key: string) => {
        let callback = clipRefsRef.current.get(key);
        if (!callback) {
            callback = (el: HTMLElement | null) => {
                if (el) {
                    clipElsRef.current.set(key, el);
                } else {
                    clipElsRef.current.delete(key);
                }
            };
            clipRefsRef.current.set(key, callback);
        }
        return callback;
    }, []);

    // Hand a body back to its own height. The clip lives on an element the fold's own commit takes
    // away — the row it belongs to is gone, or the wrapper renders no more — so this is only for a
    // slide that was interrupted before its commit.
    const releaseClips = () => {
        for (const el of clipElsRef.current.values()) {
            el.style.height = '';
            el.style.overflow = '';
        }
    };

    const start = React.useCallback((args: { keys: readonly string[]; direction: FoldDirection }) => {
        if (args.keys.length === 0) return;
        // Reduced motion: the fold still lands — the model carried it either way — it just lands at
        // once, rather than making someone who asked for less motion watch 200ms of it.
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }
        const interrupted = frameRef.current != null;
        if (interrupted) {
            window.cancelAnimationFrame(frameRef.current!);
            frameRef.current = null;
        }
        // A slide cut short hands its current heights to the next one: tapping a fold shut while it
        // is still opening should turn the body around where it is, not send it back to full first.
        carryPxRef.current = interrupted ? new Map(currentPxRef.current) : new Map();
        releaseClips();
        settledRowsRef.current = null;
        suppressedKeysRef.current = new Set(args.keys);
        setTransition({ keys: args.keys, direction: args.direction });
    }, []);

    React.useLayoutEffect(() => {
        if (transition === null) return;
        const startedAt = performance.now();
        const fromPx = new Map<string, number>();
        const toPx = new Map<string, number>();
        const carryPx = carryPxRef.current;
        for (const key of transition.keys) {
            const el = clipElsRef.current.get(key);
            if (!el) continue;
            // The body's own height with the clip off — the one number the slide needs at this end,
            // read off the element so that nothing has to describe the row from the outside.
            el.style.height = '';
            const natural = el.getBoundingClientRect().height;
            const startPx = carryPx.get(key) ?? (transition.direction === 'collapsing' ? natural : 0);
            // `overflow` goes on with the height, and both in this same pre-paint pass: the first
            // frame the reader sees is already the slide's first frame, never the body standing
            // whole for a moment and then jumping into place.
            el.style.overflow = 'hidden';
            el.style.height = `${startPx}px`;
            fromPx.set(key, startPx);
            toPx.set(key, transition.direction === 'collapsing' ? 0 : natural);
            currentPxRef.current.set(key, startPx);
        }
        const keys = [...fromPx.keys()];
        if (keys.length === 0) {
            // Every row left the window between the tap and this commit. The fold is already in the
            // model, so there is nothing to slide and nothing to hold back.
            suppressedKeysRef.current = NO_KEYS;
            setTransition(null);
            return;
        }
        const step = (now: number) => {
            frameRef.current = null;
            const progress = Math.min(1, (now - startedAt) / FOLD_HEIGHT_MS);
            const eased = easeOutCubic(progress);
            for (const key of keys) {
                const el = clipElsRef.current.get(key);
                if (!el) continue;
                const startPx = fromPx.get(key) ?? 0;
                const endPx = toPx.get(key) ?? startPx;
                const heightPx = startPx + (endPx - startPx) * eased;
                currentPxRef.current.set(key, heightPx);
                el.style.height = `${heightPx}px`;
            }
            if (progress < 1) {
                frameRef.current = window.requestAnimationFrame(step);
                return;
            }
            // Snapshot the elements here: nothing else outlives the slide. The ref the slide was
            // written through is detached in the commit this ends, which is also the commit the
            // caller measures in — so the rows the slide drew are handed over, not looked up again.
            const settled: FoldSettledRow[] = [];
            for (const key of keys) {
                const el = clipElsRef.current.get(key);
                if (el) settled.push({ key, element: el });
            }
            settledRowsRef.current = settled;
            setTransition(null);
        };
        frameRef.current = window.requestAnimationFrame(step);
        return () => {
            if (frameRef.current != null) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [transition]);

    const releaseKeys = React.useCallback((rows: readonly FoldSettledRow[]) => {
        for (const row of rows) {
            currentPxRef.current.delete(row.key);
            row.element.style.height = '';
            row.element.style.overflow = '';
        }
    }, []);

    const takeSettled = React.useCallback(() => {
        const rows = settledRowsRef.current;
        // Nothing settled: leave the suppression alone. The caller's effect runs on every change of
        // `animatingIds` — the commit that STARTS a slide included — and dropping the suppression
        // there would hand every frame of that slide to the observer as a measurement.
        if (rows == null) return null;
        settledRowsRef.current = null;
        suppressedKeysRef.current = NO_KEYS;
        return rows;
    }, []);

    return { animatingIds, suppressedKeysRef, clipRefFor, releaseKeys, start, takeSettled };
}
