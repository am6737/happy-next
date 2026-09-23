import type { Message, UserTextMessage } from '@/sync/typesMessage';
import type { TurnHeaderStatus } from './messageTurnTiming';

/**
 * Everything one row of the conversation needs to render, as plain data.
 *
 * The row used to be built inside `renderItem` from a closure over the whole conversation —
 * `turns`, `senderVisibility`, `visibleMessages` — which meant the closure's identity changed on
 * every streaming token and every mounted row re-rendered with it. A row's render inputs are now a
 * value, compared field by field (`chatRowModelsAreEqual`), so the list can re-render exactly the
 * rows that changed: the row that grew, the row whose turn just settled, the row whose fork
 * spinner turned on. See `ChatList.tsx` for how the comparison reaches LegendList.
 *
 * `message` is carried by reference and compared by reference. That is sound here because the
 * store keeps the identity of a message it did not change (`sync/storage.ts`, the merge that
 * reuses `existingSession.messagesMap[id]`), so a message the reducer rewrote is the only one that
 * compares unequal. It is the same property `turnHeaderProps` relies on for its flat scalars.
 */
export type ChatRowModel = {
    /** `message.id` — stable across a row's whole life, so the list can key its measurements by it. */
    key: string;
    message: Message;
    /** The newest row of the conversation. Read by `MessageView` to gate what it offers. */
    isNewestMessage: boolean;
    /**
     * Whether this row carries the action bar. User rows always do; an agent row only once its turn
     * settled — a reply still being written is not a finished message.
     */
    showActionBar: boolean;
    /** This row is the one a fork was started from, so its icon shows a spinner. */
    forkLoading: boolean;
    /**
     * For an agent row: the user prompt that FOLLOWS this reply, which is what a fork from the reply
     * truncates before. Null when no newer prompt is loaded — the fork then duplicates the session
     * whole. Unused on other kinds.
     */
    forkTarget: UserTextMessage | null;
    /** Whether this row's user prompt is the one that opens its run of same-sender prompts. */
    showSenderName: boolean;
    /** This row opens its turn, so the turn's header sits above it. Flat scalars, see `turnHeaderProps`. */
    isTurnStart: boolean;
    turnStartedAt: number | undefined;
    /** Null while the turn runs, undefined when this row opens no turn. */
    turnCompletedAt: number | null | undefined;
};

/**
 * The rows of the conversation, newest first — the order the store hands them over and the order
 * every index in this file means. The list itself renders them reversed (`toListOrder`).
 *
 * Computed in one pass each, so the whole build stays O(n): `forkTarget` wants the nearest NEWER
 * prompt for an agent row, which in a newest-first walk is simply the last user row already seen.
 */
export function buildChatRowModels(params: {
    visibleMessages: readonly Message[];
    /** Rows that carry the action bar, from `useTurnAnalysis`. */
    completedIds: ReadonlySet<string>;
    /** Turn header status per row id, from `useTurnAnalysis`. */
    headerById: ReadonlyMap<string, TurnHeaderStatus>;
    /** `senderVisibility` — null when the session is not shared and no row shows a sender name. */
    senderVisibility: ReadonlyMap<string, boolean> | null;
    forkingMessageId: string | null | undefined;
    /** Last committed rows; never mutated. Unchanged rows retain their identity. */
    previousRows?: ChatRowModel[];
}): ChatRowModel[] {
    const { visibleMessages, completedIds, headerById, senderVisibility, forkingMessageId } = params;
    const previousRows = params.previousRows ?? [];
    let rows: ChatRowModel[] | undefined;
    let previousByKey: Map<string, ChatRowModel> | undefined;
    // The nearest user prompt at a LOWER index, which is to say the newest one above this row.
    let newerPrompt: UserTextMessage | null = null;

    for (let index = 0; index < visibleMessages.length; index++) {
        const message = visibleMessages[index];
        const header = headerById.get(message.id);
        const isNewestMessage = index === 0;
        const showActionBar = message.kind !== 'agent-text' || completedIds.has(message.id);
        const forkLoading = !!forkingMessageId && forkingMessageId === message.id;
        const showSenderName = senderVisibility?.get(message.id) ?? false;
        const isTurnStart = header !== undefined;
        const turnStartedAt = header?.startedAt;
        const turnCompletedAt = header === undefined ? undefined : header.state === 'running' ? null : header.completedAt;
        let previous: ChatRowModel | undefined = previousRows[index];
        if (previous?.key !== message.id) {
            // Only structural edits need a key lookup; normal streaming uses the aligned array.
            previousByKey ??= new Map(previousRows.map((row) => [row.key, row]));
            previous = previousByKey.get(message.id);
        }
        const unchanged = previous !== undefined
            && previous.message === message
            && previous.isNewestMessage === isNewestMessage
            && previous.showActionBar === showActionBar
            && previous.forkLoading === forkLoading
            && previous.forkTarget === newerPrompt
            && previous.showSenderName === showSenderName
            && previous.isTurnStart === isTurnStart
            && previous.turnStartedAt === turnStartedAt
            && previous.turnCompletedAt === turnCompletedAt;
        const row = unchanged && previous ? previous : {
            key: message.id,
            message,
            isNewestMessage,
            showActionBar,
            forkLoading,
            forkTarget: newerPrompt,
            showSenderName,
            isTurnStart,
            turnStartedAt,
            turnCompletedAt,
        };
        // Copy on the first changed row, not every heartbeat that recalculates the turn analysis.
        if (!rows && row !== previousRows[index]) rows = previousRows.slice(0, index);
        if (rows) rows.push(row);

        // Kept for the rows below this one (older), whose fork target is this prompt.
        if (message.kind === 'user-text') newerPrompt = message;
    }

    if (rows) return rows;
    return previousRows.length === visibleMessages.length ? previousRows : previousRows.slice(0, visibleMessages.length);
}

/**
 * Whether two rows would render identically — the whole re-render decision for one row.
 *
 * Identity is the fast path for reused rows. The scalar comparison also supports independently
 * rebuilt models; message identity alone is insufficient when a turn settles or fork state changes.
 */
export function chatRowModelsAreEqual(a: ChatRowModel, b: ChatRowModel): boolean {
    if (a === b) return true;
    return a.message === b.message
        && a.key === b.key
        && a.isNewestMessage === b.isNewestMessage
        && a.showActionBar === b.showActionBar
        && a.forkLoading === b.forkLoading
        && a.forkTarget === b.forkTarget
        && a.showSenderName === b.showSenderName
        && a.isTurnStart === b.isTurnStart
        && a.turnStartedAt === b.turnStartedAt
        && a.turnCompletedAt === b.turnCompletedAt;
}

/**
 * The rows in the order the list renders them: oldest first.
 *
 * A non-inverted list is what lets LegendList keep chat content pinned with `alignItemsAtEnd` and
 * `maintainScrollAtEnd` instead of a transform, which is what the inverted list needed
 * (`@legendapp/list` v3 has no `inverted`). Only the array is reversed — the models keep their
 * newest-first index semantics, and the two places that meet the list's own indexes translate
 * (`listIndexFromNewestFirst` and the key-to-index map).
 */
export function toListOrder(rows: readonly ChatRowModel[]): ChatRowModel[] {
    return rows.slice().reverse();
}

/** A newest-first index (0 = newest) as the list's oldest-first index. Its own inverse. */
export function listIndexFromNewestFirst(index: number, count: number): number {
    return count - 1 - index;
}

/**
 * How far the viewport's bottom edge sits above the end of the content, in pixels.
 *
 * The scroll-to-bottom button reads this: the reader is "away from the newest message" by exactly
 * this much, where the inverted list's `contentOffset.y` measured the same distance because its
 * zero WAS the newest end. LegendList reports a plain non-inverted geometry, so the distance is
 * the arithmetic rather than the offset.
 *
 * Never negative: an end-aligned list being pulled past its end reports a layout measurement the
 * content cannot reach, and a negative distance would read as "at the end" from a rubber-band.
 */
export function distanceFromEnd(metrics: {
    contentOffset: { y: number };
    contentSize: { height: number };
    layoutMeasurement: { height: number };
}): number {
    return Math.max(0, metrics.contentSize.height - metrics.contentOffset.y - metrics.layoutMeasurement.height);
}
