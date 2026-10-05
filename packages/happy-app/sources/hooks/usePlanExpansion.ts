import { useCallback, useRef, useState } from 'react';

/**
 * How much of a plan proposal the reader has chosen to see, and how tall it turned out to be.
 */
export interface PlanExpansionState {
    /** True once the reader has asked for the whole plan. */
    expanded: boolean;
    /** The plan's own height in px, as last measured; null until it has been rendered once. */
    heightPx: number | null;
}

/**
 * Keeps a plan proposal's expansion outside the component that renders it.
 *
 * The message list is windowed — web renders only the rows in its virtual window, native uses a
 * default `FlatList` — so a row the reader scrolls past is unmounted outright, taking any
 * `useState` with it. Both answers have to outlive that: a plan the reader opened must come back
 * open, and a plan they have already seen must come back knowing whether it was long enough to
 * need the button at all, or the row would flash open (or buttonless) for the frame before it is
 * measured again.
 *
 * Deliberately memory only. The fold is a reading convenience, not a setting, and a restart is a
 * context change the reader made themselves — nothing here is worth carrying into the next run.
 *
 * The row is keyed by message id, so a row's id is its identity: the state is seeded on mount and
 * never re-read, which is exactly what a keyed list wants.
 */
const expansions = new Map<string, PlanExpansionState>();

export function usePlanExpansion(messageId: string | undefined): PlanExpansionState & {
    toggle: () => void;
    reportHeight: (heightPx: number) => void;
} {
    const [state, setState] = useState<PlanExpansionState>(
        () => (messageId == null ? undefined : expansions.get(messageId)) ?? { expanded: false, heightPx: null }
    );
    // The only writer is `commit` below, which also keeps this in step, so the callbacks can stay
    // free of the state they would otherwise have to depend on.
    const latest = useRef(state);

    const commit = useCallback((next: PlanExpansionState) => {
        const current = latest.current;
        if (current.expanded === next.expanded && current.heightPx === next.heightPx) return;
        latest.current = next;
        if (messageId != null) {
            expansions.set(messageId, next);
        }
        setState(next);
    }, [messageId]);

    const toggle = useCallback(() => {
        commit({ expanded: !latest.current.expanded, heightPx: latest.current.heightPx });
    }, [commit]);

    const reportHeight = useCallback((heightPx: number) => {
        commit({ expanded: latest.current.expanded, heightPx });
    }, [commit]);

    return { expanded: state.expanded, heightPx: state.heightPx, toggle, reportHeight };
}
