import * as React from 'react';
import type { TurnProcess } from '@/components/messageTurnTiming';
import { turnFoldControl, type TurnFoldControl } from '@/components/turnFold';

const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

export type TurnFolding = {
    /** Rows the list drops, because the turn they belong to is folded. */
    hiddenIds: ReadonlySet<string>;
    /** The folded line's state for the rows that open a foldable turn, keyed by that row's id. */
    controlByHeaderId: ReadonlyMap<string, TurnFoldControl>;
    /** Flip one turn, whatever the setting says. Stable, so list rows keep their props. */
    toggle: (headerId: string) => void;
};

/**
 * Which turns are showing their process and which are showing one line.
 *
 * The decision per turn is `turnFoldControl`; what lives here is the one thing it cannot know — which
 * turns the reader has opened or closed themselves. A tap outranks the setting, and is remembered by
 * the header row's id, which is stable for as long as the turn is in the list.
 *
 * The set of hidden rows is handed back as a set rather than applied, because dropping rows is the
 * list's job: both lists size rows from measured heights, so a row that stops rendering has to leave
 * the key set entirely, not survive as an empty element holding the height it was once given.
 */
export function useTurnFolding(params: {
    /** `TurnAnalysis.foldById` — every turn worth folding, running ones included. */
    foldById: ReadonlyMap<string, TurnProcess>;
    enabled: boolean;
}): TurnFolding {
    const { foldById, enabled } = params;
    const [overrides, setOverrides] = React.useState<ReadonlyMap<string, boolean>>(NO_OVERRIDES);

    const { controlByHeaderId, hiddenIds } = React.useMemo(() => {
        const controls = new Map<string, TurnFoldControl>();
        const hidden = new Set<string>();
        for (const [headerId, process] of foldById) {
            const control = turnFoldControl({ process, enabled, override: overrides.get(headerId) });
            if (control === null) continue;
            controls.set(headerId, control);
            if (control.folded) {
                for (const id of process.hiddenIds) hidden.add(id);
            }
        }
        return { controlByHeaderId: controls, hiddenIds: hidden };
    }, [foldById, enabled, overrides]);

    // Read through a ref so `toggle` never changes identity: it is handed to every list row.
    const controlsRef = React.useRef(controlByHeaderId);
    controlsRef.current = controlByHeaderId;

    const toggle = React.useCallback((headerId: string) => {
        const folded = controlsRef.current.get(headerId)?.folded;
        if (folded === undefined) return;
        setOverrides((prev) => {
            const next = new Map(prev);
            next.set(headerId, !folded);
            return next;
        });
    }, []);

    return { hiddenIds, controlByHeaderId, toggle };
}
