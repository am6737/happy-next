import * as React from 'react';
import type { TurnProcess } from '@/components/messageTurnTiming';
import { resolveTurnFolding, type TurnFoldResolution } from '@/components/turnFold';

const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

export type TurnFolding = TurnFoldResolution & {
    /** Flip one turn's line, whatever the setting says. Stable, so list rows keep their props. */
    toggle: (headerId: string) => void;
    /** Flip one run's line. Stable, for the same reason. */
    toggleSegment: (startId: string) => void;
    /**
     * The rows a tap on a turn's line (`turn`) or a run's line (`segment`) would show or hide, which
     * is not simply the rows that line stands for: a row an open run keeps folded under a turn that
     * is being opened stays hidden, and one the turn had already hidden does not move when a run in it
     * is tapped. Read off the state as it is now, so it has to be asked before the toggle.
     */
    idsChangedBy: (tap: { turn: string } | { segment: string }) => string[];
};

/**
 * Which turns are showing their process and which are showing one line, and the same for the runs of
 * steps inside a turn.
 *
 * The decision per line is `resolveTurnFolding`; what lives here is the one thing it cannot know —
 * which lines the reader has opened or closed themselves. A tap outranks the default, and is
 * remembered by the id of the row the line is drawn on, which is stable for as long as the turn is in
 * the list.
 *
 * A turn's line and the line of the run that starts on the same row are two lines on one row, so
 * their taps are kept apart.
 *
 * The set of hidden rows is handed back as a set rather than applied, because dropping rows is the
 * list's job: it sizes rows from measured heights, so a hidden row has to hold its place in the model
 * at no height rather than leave it.
 */
export function useTurnFolding(params: {
    /** `TurnAnalysis.foldById` — every turn worth folding, running ones included. */
    foldById: ReadonlyMap<string, TurnProcess>;
    /** `TurnAnalysis.newestHeaderId` — the only turn whose process opens in runs. */
    newestHeaderId: string | null;
    /** Whether a run of steps starts folded. */
    enabled: boolean;
}): TurnFolding {
    const { foldById, newestHeaderId, enabled } = params;
    const [turnOverrides, setTurnOverrides] = React.useState<ReadonlyMap<string, boolean>>(NO_OVERRIDES);
    const [segmentOverrides, setSegmentOverrides] = React.useState<ReadonlyMap<string, boolean>>(NO_OVERRIDES);

    const resolution = React.useMemo(
        () => resolveTurnFolding({ foldById, newestHeaderId, enabled, turnOverrides, segmentOverrides }),
        [foldById, newestHeaderId, enabled, turnOverrides, segmentOverrides],
    );

    // Read through a ref so the callbacks never change identity: they are handed to every list row.
    const latestRef = React.useRef({ foldById, newestHeaderId, enabled, turnOverrides, segmentOverrides, resolution });
    latestRef.current = { foldById, newestHeaderId, enabled, turnOverrides, segmentOverrides, resolution };

    const toggle = React.useCallback((headerId: string) => {
        const folded = latestRef.current.resolution.controlByHeaderId.get(headerId)?.folded;
        if (folded === undefined) return;
        setTurnOverrides((prev) => new Map(prev).set(headerId, !folded));
    }, []);

    const toggleSegment = React.useCallback((startId: string) => {
        const folded = latestRef.current.resolution.segmentControlByStartId.get(startId)?.folded;
        if (folded === undefined) return;
        setSegmentOverrides((prev) => new Map(prev).set(startId, !folded));
    }, []);

    const idsChangedBy = React.useCallback((tap: { turn: string } | { segment: string }): string[] => {
        const { foldById, newestHeaderId, enabled, turnOverrides, segmentOverrides, resolution } = latestRef.current;
        let next: TurnFoldResolution;
        if ('turn' in tap) {
            const folded = resolution.controlByHeaderId.get(tap.turn)?.folded;
            if (folded === undefined) return [];
            next = resolveTurnFolding({
                foldById,
                newestHeaderId,
                enabled,
                turnOverrides: new Map(turnOverrides).set(tap.turn, !folded),
                segmentOverrides,
            });
        } else {
            const folded = resolution.segmentControlByStartId.get(tap.segment)?.folded;
            if (folded === undefined) return [];
            next = resolveTurnFolding({
                foldById,
                newestHeaderId,
                enabled,
                turnOverrides,
                segmentOverrides: new Map(segmentOverrides).set(tap.segment, !folded),
            });
        }
        const changed: string[] = [];
        for (const id of resolution.hiddenIds) if (!next.hiddenIds.has(id)) changed.push(id);
        for (const id of next.hiddenIds) if (!resolution.hiddenIds.has(id)) changed.push(id);
        return changed;
    }, []);

    return { ...resolution, toggle, toggleSegment, idsChangedBy };
}
