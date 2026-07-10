import * as React from 'react';
import { useSession, useSessionMessages, useProfile, storage } from "@/sync/storage";
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { MessageView } from './MessageView';
import { ConversationMinimapItem } from './ConversationMinimap';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message, UserTextMessage } from '@/sync/typesMessage';
import { layout as appLayout } from './layout';
import { createScrollButtonVisibilityController } from './scrollButtonVisibilityController';
import { t } from '@/text';
import {
    buildLayoutModel,
    compensatedDistanceFromBottom,
    computeVisibleRange,
    distanceToAlignEntryTop,
    distanceToCenterEntry,
    nextViewportState,
    pickCompensationAnchor,
    rangeAroundAnchor,
    sameKeys,
    type LayoutModel,
    type RenderRange,
    type ViewportState,
} from './chatListVirtualModel';

// Web-only ChatList. The native implementation (./ChatList.tsx, inverted
// FlatList) stays untouched; this file replaces it on web.
//
// Architecture (modeled on the Codex desktop thread list):
//
// 1. column-reverse scroll container with a SINGLE normal-order child.
//    column-reverse contributes no visual ordering here — only its coordinate
//    semantics: scrollTop 0 is the bottom (negative when scrolled up, per
//    CSSOM), so first-paint-at-bottom and stick-to-bottom are structural, and
//    content growth above the viewport can never move it. All code below works
//    in distance-from-bottom pixels (= |scrollTop|).
//
// 2. A windowed virtualizer driven by a pure layout model
//    (chatListVirtualModel.ts): per-message measured/estimated heights →
//    prefix sums → binary-searched render range. Only the visible window
//    (± overscan) is mounted; the window sits inside a fixed-height container
//    positioned by a single marginTop spacer, so rows stay in real document
//    flow. Freshly mounted, never-measured rows are height-CONSTRAINED to
//    their model height (overflow hidden) so mounting cannot shift layout;
//    a pre-paint measurement pass then feeds real sizes back into the model
//    and compensates the scroll position for any size change below the
//    viewport. All corrections happen before paint (ResizeObserver callbacks
//    and layout effects both run pre-paint).
//
// 3. Codex-style history model: the full session history is drained into
//    memory in the background (page after page); the minimap only appears
//    once everything is loaded, so a minimap jump never triggers paging —
//    it either smooth-scrolls to a mounted row or teleports the window to
//    the target and positions it instantly from the model.
//
// 4. Per-session restore: measured heights, the rendered window anchor and
//    the scroll offset are remembered per session and re-applied before first
//    paint on revisit — the first frame IS the final frame.
//
// Data direction: the store is newest-first (index 0 = newest); all
// direction-sensitive logic matches the native list verbatim on that order.
// The virtualizer model uses chronological (oldest-first) keys, mapped by
// index arithmetic at the render boundary.

// --- Keep in sync with ChatList.tsx (duplicated to avoid a self-resolving
// platform import: './ChatList' resolves back to this file on web) ---

const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/;

function isCompactionMarkerText(text: string): boolean {
    return LOCAL_COMMAND_STDOUT_PATTERN.test(text.trim());
}

function shouldHideMessageInChatList(message: Message): boolean {
    return message.kind === 'user-text' && isCompactionMarkerText(message.displayText ?? message.text);
}

// Does a loaded list message correspond to the given minimap target (whose id may come from the
// throwaway reducer and therefore not match the store's id)?
function messageMatchesTarget(message: Message, target: UserTextMessage): boolean {
    if (target.seq != null && message.seq === target.seq) return true;
    if (target.localId && (message as { localId?: string | null }).localId === target.localId) return true;
    return message.id === target.id;
}

// Describes a fork initiated from a message's inline fork icon.
export interface ForkMessageRequest {
    // The user message to truncate before — the new session keeps everything
    // older than it. For a fork from an AI reply this is the user prompt that
    // FOLLOWS the reply (so the reply itself is kept); `null` means there is no
    // following prompt, so the whole session is duplicated with no truncation.
    target: UserTextMessage | null;
    // The message whose fork icon was tapped — drives the inline loading spinner.
    loadingMessageId: string;
    // Suppress the new-session draft. User-message forks pre-fill the tapped
    // prompt; AI-message forks continue after the reply, so there's nothing to
    // pre-fill.
    skipDraft: boolean;
}

// --- End of the sync block ---

// A loaded user message paired with its index in the newest-first `visibleMessages`.
type LoadedUserMessage = { message: UserTextMessage; index: number };

export const ChatList = React.memo((props: { session: Session; onFillInput?: (text: string, allOptions?: string[]) => void; onLoadMore?: () => void; onForkMessage?: (request: ForkMessageRequest) => void; forkingMessageId?: string | null; minimapCachedUserMessages?: UserTextMessage[]; onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void; onActiveMessageIdsChange?: (ids: Set<string>) => void; onRegisterMinimapJump?: (jump: ((message: UserTextMessage) => void) | null) => void }) => {
    const { messages, hasMore } = useSessionMessages(props.session.id);
    const profile = useProfile();
    const isSharedSession = !!(props.session.isShared || props.session.accessLevel);
    return (
        <ChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            hasMore={hasMore}
            onFillInput={props.onFillInput}
            onLoadMore={props.onLoadMore}
            isSharedSession={isSharedSession}
            currentUserId={profile.id}
            onForkMessage={props.onForkMessage}
            thinking={props.session.thinking}
            forkingMessageId={props.forkingMessageId}
            onMinimapItemsChange={props.onMinimapItemsChange}
            onActiveMessageIdsChange={props.onActiveMessageIdsChange}
            onRegisterMinimapJump={props.onRegisterMinimapJump}
        />
    )
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

// Distance from the bottom (px) within which the list counts as "at bottom":
// hides the scroll button and keeps the viewport glued to streaming output.
const SCROLL_THRESHOLD = 100;
const SHOW_SCROLL_BUTTON_DELAY_MS = 300;
// Inside the glue band but not exactly at 0, an upward touchpad gesture moves
// only a few px per frame; snapping back to the bottom mid-gesture would trap
// the user. Content growth yields to input this recent.
const USER_SCROLL_GRACE_MS = 400;
// Model estimate for a never-measured row. Only affects the scrollbar length
// for unseen regions and constrained-mount placeholder sizes — never the
// viewport (estimate errors live above it or are compensated below it).
const ROW_ESTIMATE_PX = 100;
// Rows kept mounted beyond the visible ones, per side.
const OVERSCAN_ROWS = 10;
// Gap between the viewport top inset and a jump target's top edge.
const JUMP_TOP_MARGIN_PX = 10;
// Codex-style animated "scroll to bottom" (cubic ease-out).
const SCROLL_TO_BOTTOM_ANIMATION_MS = 260;
// Viewport height guess used before the scroller is measured.
const INITIAL_VIEWPORT_GUESS_PX = 800;
// A pending scroll restore is considered landed within this tolerance.
const RESTORE_TOLERANCE_PX = 24;
// Consecutive no-progress background-drain retries before pausing.
const DRAIN_MAX_NO_PROGRESS_RETRIES = 3;
// Post-jump row highlight (Codex flash).
const HIGHLIGHT_DURATION_MS = 1400;

const EMPTY_MINIMAP_ITEMS: ConversationMinimapItem[] = [];

// Per-session state restored on remount (before first paint) so revisiting a
// conversation shows the final frame immediately: raw scroll offset, height
// cache and the rendered-window anchor. Bounded so long-lived app sessions
// don't accumulate forever.
type SessionRestoreState = {
    // Raw |scrollTop| (content-space, includes the footer band).
    scrollDistancePx: number;
    atBottom: boolean;
    heightsByKey: Record<string, number>;
    renderedWindow: { anchorKey: string; count: number } | null;
};
const sessionRestoreStates = new Map<string, SessionRestoreState>();
const SESSION_RESTORE_CAP = 20;
function rememberSessionRestoreState(sessionId: string, state: SessionRestoreState) {
    sessionRestoreStates.delete(sessionId);
    sessionRestoreStates.set(sessionId, state);
    if (sessionRestoreStates.size > SESSION_RESTORE_CAP) {
        const oldest = sessionRestoreStates.keys().next().value;
        if (oldest != null) {
            sessionRestoreStates.delete(oldest);
        }
    }
}

const contentColumnStyle = {
    display: 'flex',
    flexDirection: 'column',
    // Shorter-than-viewport content packs to the bottom (chat convention,
    // matches the native inverted list).
    justifyContent: 'flex-end',
    minHeight: '100%',
    flexShrink: 0,
} as React.CSSProperties;

const windowColumnStyle = {
    display: 'flex',
    flexDirection: 'column',
} as React.CSSProperties;

const rowOuterStyle = {
    // Flex children default to shrink 1 — without this the column would
    // compress into the viewport instead of overflowing.
    flexShrink: 0,
} as React.CSSProperties;

const rowInnerStyle = {
    // Inner flex column prevents the RNW row's margins from collapsing through
    // the wrapper (escaped margins would corrupt the row's measured box).
    display: 'flex',
    flexDirection: 'column',
} as React.CSSProperties;

// One message row. Memoized so a streaming update re-renders only the rows
// whose props actually changed, not every mounted row on each token.
//
// While a row is mounted but not yet measured, the OUTER wrapper is
// constrained to the model's height (overflow hidden) so the mount itself
// cannot move anything; the INNER element renders at natural size and is what
// the ResizeObserver measures, so the real height reaches the model even
// while the constraint is active.
const ChatRow = React.memo((props: {
    message: Message,
    metadata: Metadata | null,
    sessionId: string,
    isNewestMessage: boolean,
    onFillInput?: (text: string, allOptions?: string[]) => void,
    // Present only when this row is allowed to fork (private session + fork
    // handler + action bar for agent rows) — keeps the memo props flat.
    onForkMessage?: (request: ForkMessageRequest) => void,
    // For agent rows: the user prompt FOLLOWING this reply (null = none).
    forkTarget: UserTextMessage | null,
    showActionBar: boolean,
    forkLoading: boolean,
    isSharedSession: boolean,
    currentUserId: string,
    showSenderName: boolean,
    constrainedHeightPx: number | undefined,
    refCallback: (el: HTMLDivElement | null) => void,
}) => {
    const { message, onForkMessage, forkTarget } = props;
    let onFork: (() => void) | undefined;
    if (onForkMessage) {
        if (message.kind === 'user-text') {
            const target = message;
            onFork = () => onForkMessage({ target, loadingMessageId: message.id, skipDraft: false });
        } else {
            onFork = () => onForkMessage({ target: forkTarget, loadingMessageId: message.id, skipDraft: true });
        }
    }
    const outerStyle = props.constrainedHeightPx != null
        ? { height: props.constrainedHeightPx, overflow: 'hidden', flexShrink: 0 } as React.CSSProperties
        : rowOuterStyle;
    return (
        <div style={outerStyle}>
            <div ref={props.refCallback} style={rowInnerStyle}>
                <MessageView
                    message={message}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    isNewestMessage={props.isNewestMessage}
                    onFillInput={props.onFillInput}
                    onFork={onFork}
                    showActionBar={props.showActionBar}
                    forkLoading={props.forkLoading}
                    isSharedSession={props.isSharedSession}
                    currentUserId={props.currentUserId}
                    showSenderName={props.showSenderName}
                />
            </div>
        </div>
    );
});

type PendingJump = { key: string; nonce: number };
type PendingMeasureOps = {
    // While a session restore is pending, measurement batches re-assert the
    // saved offset instead of compensating (the saved offset IS the truth).
    restore: boolean;
    // Raw scroll distance to apply after the commit (null = leave as is).
    scrollDistancePx: number | null;
    // Identity token: the drain effect only consumes ops for ITS commit.
    heights: Record<string, number>;
};

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    hasMore: boolean,
    onFillInput?: (text: string, allOptions?: string[]) => void,
    onLoadMore?: () => void,
    isSharedSession: boolean,
    currentUserId: string,
    onForkMessage?: (request: ForkMessageRequest) => void,
    thinking?: boolean,
    forkingMessageId?: string | null,
    onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void,
    onActiveMessageIdsChange?: (ids: Set<string>) => void,
    onRegisterMinimapJump?: (jump: ((message: UserTextMessage) => void) | null) => void,
}) => {
    const { theme } = useUnistyles();
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    // The floating header overlays the scroller top; jumps align targets below it.
    const headerInsetPx = headerHeight + safeArea.top + 32;
    const scrollerElRef = useRef<HTMLDivElement | null>(null);
    const sessionIdRef = useRef(props.sessionId);
    sessionIdRef.current = props.sessionId;

    // ---- Data layer (newest-first, matches native ChatList.tsx verbatim) ----

    const visibleMessages = React.useMemo(
        () => props.messages.filter((message) => !shouldHideMessageInChatList(message)),
        [props.messages]
    );
    const visibleMessagesRef = useRef(visibleMessages);
    visibleMessagesRef.current = visibleMessages;

    // Compute which user-text messages should show sender name labels.
    // In the newest-first array (index 0 = newest), show name when the next item
    // in the array (= older message at higher index) is from a different sender
    // or is not a user-text message, so only the first in a consecutive group shows it.
    const senderVisibility = React.useMemo(() => {
        if (!props.isSharedSession) return null;
        const map = new Map<string, boolean>();
        for (let i = 0; i < visibleMessages.length; i++) {
            const msg = visibleMessages[i];
            if (msg.kind !== 'user-text') continue;
            const nextMsg = visibleMessages[i + 1];
            const nextSentBy = nextMsg?.kind === 'user-text' ? nextMsg.sentBy : null;
            map.set(msg.id, msg.sentBy !== nextSentBy);
        }
        return map;
    }, [visibleMessages, props.isSharedSession]);

    // Compute which agent-text messages are the LAST text segment of their turn.
    // An assistant turn can span several agent-text blocks (interleaved with
    // tool calls / thinking); the action bar (copy + time) should appear only
    // once per turn, on its final text block. In the newest-first array (index
    // 0 = newest), scanning toward newer (lower index): the first non-thinking
    // agent-text means a newer text block exists (not last); a user-text means
    // we've reached the turn boundary (this turn is complete → this is its last
    // segment); tool-call / agent-event / thinking blocks are skipped.
    //
    // The newest turn (scan reaches the start without hitting a user message)
    // is only marked complete when the agent is idle (`!thinking`); while the
    // agent is still generating, the bar is suppressed for the whole turn so it
    // doesn't attach to a segment that isn't truly final yet.
    // Latch of segment ids already shown as their turn's final segment. Keeps the
    // bar shown if `thinking` briefly flips true again (it can turn true a frame
    // before a freshly-sent user message lands in the list), avoiding a flicker.
    const completedTurnIdsRef = useRef<Set<string>>(new Set());
    const lastAgentSegmentIds = React.useMemo(() => {
        const set = new Set<string>();
        const previouslyCompleted = completedTurnIdsRef.current;
        const stillCompleted = new Set<string>();
        for (let i = 0; i < visibleMessages.length; i++) {
            const msg = visibleMessages[i];
            if (msg.kind !== 'agent-text' || msg.isThinking) continue;
            let isLast = true;
            let reachedUserBoundary = false;
            for (let j = i - 1; j >= 0; j--) {
                const newer = visibleMessages[j];
                if (newer.kind === 'agent-text' && !newer.isThinking) { isLast = false; break; }
                if (newer.kind === 'user-text') { reachedUserBoundary = true; break; }
            }
            if (!isLast) continue;
            // Older (already-bounded) turns are always complete; the newest turn
            // only counts as complete once the agent stops thinking — unless it
            // was already shown as complete (latched).
            if (reachedUserBoundary || !props.thinking || previouslyCompleted.has(msg.id)) {
                set.add(msg.id);
                stillCompleted.add(msg.id);
            }
        }
        completedTurnIdsRef.current = stillCompleted;
        return set;
    }, [visibleMessages, props.thinking]);

    // For each agent message, the user prompt that FOLLOWS it in time (nearest
    // lower index in the newest-first array) — the fork truncation target for
    // AI-reply forks. Single pass instead of a per-row backward scan.
    const forkTargetsById = React.useMemo(() => {
        const map = new Map<string, UserTextMessage | null>();
        let nextUserMessage: UserTextMessage | null = null;
        for (let i = 0; i < visibleMessages.length; i++) {
            const msg = visibleMessages[i];
            if (msg.kind === 'user-text') {
                nextUserMessage = msg;
            } else if (msg.kind === 'agent-text') {
                map.set(msg.id, nextUserMessage);
            }
        }
        return map;
    }, [visibleMessages]);

    // Loaded user messages in ascending (oldest→newest) order, carrying their index into the
    // newest-first `visibleMessages`. Used for the active-marker nearest-neighbor computation
    // while scrolling and as the minimap item source.
    const loadedUserMessages = React.useMemo<LoadedUserMessage[]>(() => {
        return visibleMessages
            .map((message, index) => message.kind === 'user-text'
                ? { message, index }
                : null)
            .filter((item): item is LoadedUserMessage => item !== null)
            .reverse();
    }, [visibleMessages]);
    const loadedUserMessagesRef = useRef(loadedUserMessages);
    loadedUserMessagesRef.current = loadedUserMessages;

    // Codex history model: the minimap appears only once the FULL history is
    // in memory (the background drain below loads it), so every minimap target
    // is a loaded message and a jump can never trigger paging. Until then the
    // minimap stays hidden (ConversationMinimap renders nothing for < 2 items).
    // The offline prompt cache (minimapCachedUserMessages) is intentionally
    // unused here — loaded data is the only source.
    const minimapItems = React.useMemo<ConversationMinimapItem[]>(() => {
        if (props.hasMore) return EMPTY_MINIMAP_ITEMS;
        return loadedUserMessages.map((item) => ({ message: item.message }));
    }, [props.hasMore, loadedUserMessages]);
    const activeMessageIdsRef = useRef<Set<string>>(new Set());

    // ---- Virtualizer model ----

    // Chronological (oldest-first) entry keys for the layout model.
    const entryKeys = React.useMemo(() => {
        const keys = new Array<string>(visibleMessages.length);
        for (let i = 0; i < visibleMessages.length; i++) {
            keys[visibleMessages.length - 1 - i] = visibleMessages[i].id;
        }
        return keys;
    }, [visibleMessages]);

    // Session restore state, read once at mount (the component remounts per session).
    const [restored] = useState(() => sessionRestoreStates.get(props.sessionId));
    const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(() => restored?.heightsByKey ?? {});
    const measuredHeightsRef = useRef(measuredHeights);
    measuredHeightsRef.current = measuredHeights;

    const layout = React.useMemo(
        () => buildLayoutModel({ keys: entryKeys, measuredHeightsByKey: measuredHeights, estimateHeightPx: ROW_ESTIMATE_PX }),
        [entryKeys, measuredHeights]
    );
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    const [viewport, setViewport] = useState<ViewportState>(() => {
        const distance = restored && !restored.atBottom ? restored.scrollDistancePx : 0;
        const base = computeVisibleRange({ layout, distanceFromBottomPx: distance, viewportHeightPx: INITIAL_VIEWPORT_GUESS_PX, overscanCount: OVERSCAN_ROWS });
        let range = base;
        if (restored?.renderedWindow) {
            const around = rangeAroundAnchor({
                layout,
                anchorKey: restored.renderedWindow.anchorKey,
                previousRange: { startIndex: 0, endIndex: Math.min(restored.renderedWindow.count, base.endIndex - base.startIndex) },
            });
            if (around) range = around;
        }
        return { distanceFromBottomPx: distance, renderedRange: range, keys: layout.keys, viewportHeightPx: INITIAL_VIEWPORT_GUESS_PX };
    });
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    const [pendingJump, setPendingJump] = useState<PendingJump | null>(null);
    const pendingJumpRef = useRef<PendingJump | null>(null);

    // ---- Scroll state ----
    const atBottomRef = useRef(restored ? restored.atBottom : true);
    // Far in the past — `performance.now()` starts near 0, so initializing to 0
    // would count the first 400ms of page life as "user is scrolling".
    const lastUserInputAtRef = useRef(-1e9);
    // Raw |scrollTop| target of a pending session restore; re-asserted after
    // every measurement batch until it lands (or the user takes over).
    const pendingRestoreRef = useRef<number | null>(restored && !restored.atBottom ? restored.scrollDistancePx : null);
    // Height of the footer block at the content bottom — the offset between
    // raw scroll distance (content space) and model distance (list space).
    const footerHeightRef = useRef(0);
    const isAnimatingScrollRef = useRef(false);
    const scrollAnimationFrameRef = useRef<number | null>(null);

    const [showScrollButton, setShowScrollButton] = useState(false);
    const visibilityControllerRef = useRef<ReturnType<typeof createScrollButtonVisibilityController> | null>(null);
    const lastSeenTimestampRef = useRef<number>(visibleMessages[0]?.createdAt ?? 0);
    const isLoadingMoreRef = useRef(false);
    const [isLocating, setIsLocating] = useState(false);

    // Calculate unread count: count messages newer than the last seen timestamp
    let unreadCount = 0;
    if (showScrollButton) {
        for (const msg of visibleMessages) {
            if (msg.createdAt > lastSeenTimestampRef.current) {
                unreadCount++;
            } else {
                break; // messages are sorted newest-first, no need to continue
            }
        }
    }

    // ---- Coordinate helpers ----

    const getRawDistance = () => {
        const scroller = scrollerElRef.current;
        return scroller ? Math.abs(scroller.scrollTop) : 0;
    };
    const toModelDistance = (raw: number) => Math.max(0, raw - footerHeightRef.current);
    const setRawDistance = (raw: number) => {
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        scroller.scrollTop = raw === 0 ? 0 : -raw;
        atBottomRef.current = Math.abs(scroller.scrollTop) <= SCROLL_THRESHOLD;
    };

    const cancelScrollAnimation = () => {
        if (scrollAnimationFrameRef.current != null) {
            window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
        }
        isAnimatingScrollRef.current = false;
    };

    // ---- Measurement pipeline (the heart of the virtualizer) ----

    const rowElsByKeyRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const keyByElementRef = useRef<Map<Element, string>>(new Map());
    // Rows mounted this commit, awaiting their synchronous first measurement.
    const pendingFirstMeasureRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const pendingOpsRef = useRef<PendingMeasureOps | null>(null);
    // Layout snapshot taken before the first measurement rebuild since the last
    // entries-change compensation — measurement deltas after it are already
    // compensated (via mBelow), so the entries effect must diff against it.
    const preMeasureLayoutRef = useRef<LayoutModel | null>(null);
    const committedLayoutRef = useRef<LayoutModel>(layout);

    // Apply a batch of measured row heights: update the height cache, rebuild
    // the model, and stage a single scroll adjustment for any size change
    // BELOW the viewport (bottom-anchored coordinates shift only from below).
    // At the bottom, pin to 0 instead. Runs pre-paint in every path.
    const applyMeasuredHeights = (batch: Map<string, { element: HTMLElement; heightPx: number }>, useFlushSyncCommit: boolean): boolean => {
        const staged = pendingOpsRef.current;
        const current = measuredHeightsRef.current;
        const layoutNow = layoutRef.current;
        let next = current;
        const rawNow = getRawDistance();
        // Reference for "below the viewport": once ops are staged, the staged
        // target (not the not-yet-applied DOM value) is the truth.
        const referenceModel = staged?.scrollDistancePx != null
            ? toModelDistance(staged.scrollDistancePx)
            : toModelDistance(rawNow);
        let deltaBelow = 0;
        for (const [key, { element, heightPx }] of batch) {
            if (rowElsByKeyRef.current.get(key) !== element) continue;
            const height = Math.max(1, heightPx);
            if (next[key] === height) continue;
            if (next === current) next = { ...current };
            next[key] = height;
            const index = layoutNow.indexByKey.get(key);
            if (index == null) continue;
            const deltaVsLayout = height - (layoutNow.heightsPx[index] ?? height);
            if (deltaVsLayout !== 0 && (layoutNow.bottomOffsetsPx[index] ?? 0) <= referenceModel) {
                deltaBelow += deltaVsLayout;
            }
        }
        if (next === current) return false;

        const restoreMode = pendingRestoreRef.current != null;
        const withinGrace = performance.now() - lastUserInputAtRef.current < USER_SCROLL_GRACE_MS;
        const pinToBottom = atBottomRef.current && (!withinGrace || rawNow === 0);
        let scrollDistancePx: number | null;
        if (restoreMode) {
            scrollDistancePx = null;
        } else if (pinToBottom) {
            scrollDistancePx = 0;
        } else if (deltaBelow !== 0) {
            scrollDistancePx = Math.max(0, (staged?.scrollDistancePx ?? rawNow) + deltaBelow);
        } else {
            scrollDistancePx = staged?.scrollDistancePx ?? null;
        }

        measuredHeightsRef.current = next;
        preMeasureLayoutRef.current ??= layoutNow;
        const nextLayout = buildLayoutModel({ keys: layoutNow.keys, measuredHeightsByKey: next, estimateHeightPx: ROW_ESTIMATE_PX });
        const targetModel = restoreMode
            ? toModelDistance(pendingRestoreRef.current ?? 0)
            : toModelDistance(scrollDistancePx ?? rawNow);
        const nextViewport = nextViewportState({
            current: viewportRef.current,
            layout: nextLayout,
            distanceFromBottomPx: targetModel,
            viewportHeightPx: viewportRef.current.viewportHeightPx,
            overscanCount: OVERSCAN_ROWS,
        });
        pendingOpsRef.current = { restore: restoreMode, scrollDistancePx, heights: next };
        const commit = () => {
            setMeasuredHeights(next);
            if (nextViewport !== viewportRef.current) {
                viewportRef.current = nextViewport;
                setViewport(nextViewport);
            }
        };
        if (useFlushSyncCommit) {
            flushSync(commit);
        } else {
            commit();
        }
        return true;
    };
    const applyMeasuredHeightsRef = useRef(applyMeasuredHeights);
    applyMeasuredHeightsRef.current = applyMeasuredHeights;

    const updateViewport = (rawDistance: number, viewportHeightPx: number) => {
        // A staged measurement commit already computed the next viewport
        // against the new layout; don't overwrite it from the stale one.
        if (pendingOpsRef.current) return;
        const next = nextViewportState({
            current: viewportRef.current,
            layout: layoutRef.current,
            distanceFromBottomPx: toModelDistance(rawDistance),
            viewportHeightPx,
            overscanCount: OVERSCAN_ROWS,
        });
        if (next !== viewportRef.current) {
            viewportRef.current = next;
            setViewport(next);
        }
    };
    const updateViewportRef = useRef(updateViewport);
    updateViewportRef.current = updateViewport;

    // Re-assert a pending session restore. Consumed once it lands within
    // tolerance, or once it's clear it can never land (content exhausted).
    const reassertPendingRestore = () => {
        const target = pendingRestoreRef.current;
        if (target == null) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        setRawDistance(target);
        const actual = Math.abs(scroller.scrollTop);
        if (Math.abs(actual - target) <= RESTORE_TOLERANCE_PX) {
            pendingRestoreRef.current = null;
        } else if (!props.hasMore && scroller.scrollHeight - scroller.clientHeight < target - RESTORE_TOLERANCE_PX) {
            // All content is loaded and it simply isn't tall enough anymore.
            pendingRestoreRef.current = null;
        }
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
    };
    const reassertPendingRestoreRef = useRef(reassertPendingRestore);
    reassertPendingRestoreRef.current = reassertPendingRestore;

    // Shared ResizeObserver over the INNER (natural-size) row elements.
    const rowResizeObserverRef = useRef<ResizeObserver | null>(null);
    const ensureRowResizeObserver = () => {
        if (rowResizeObserverRef.current || typeof ResizeObserver === 'undefined') return rowResizeObserverRef.current;
        const observer = new ResizeObserver((entries) => {
            const batch = new Map<string, { element: HTMLElement; heightPx: number }>();
            for (const entry of entries) {
                const key = keyByElementRef.current.get(entry.target);
                if (key == null) continue;
                const el = entry.target as HTMLElement;
                const heightPx = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
                if (heightPx > 0) batch.set(key, { element: el as HTMLDivElement, heightPx });
            }
            // ResizeObserver callbacks run before paint; flushSync commits the
            // new heights + window and the drain effect applies the scroll
            // correction — the whole chain is invisible.
            if (batch.size > 0) applyMeasuredHeightsRef.current(batch, true);
        });
        rowResizeObserverRef.current = observer;
        return observer;
    };

    // ---- Viewability via IntersectionObserver (minimap active highlight) ----
    const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
    const visibleIdsRef = useRef<Set<string>>(new Set());
    const onActiveMessageIdsChangeRef = useRef(props.onActiveMessageIdsChange);
    onActiveMessageIdsChangeRef.current = props.onActiveMessageIdsChange;

    const recomputeActiveIds = useCallback(() => {
        const items = visibleMessagesRef.current;
        const indexById = new Map<string, number>();
        items.forEach((message, index) => indexById.set(message.id, index));
        const next = new Set<string>();
        const visibleIndexes: number[] = [];
        for (const id of visibleIdsRef.current) {
            const index = indexById.get(id);
            if (index == null) continue;
            visibleIndexes.push(index);
            if (items[index]?.kind === 'user-text') {
                next.add(id);
            }
        }

        // If the viewport is between two user prompts (e.g. only assistant/tool output is
        // visible), keep the rail useful by highlighting the nearest loaded user prompt.
        // If nothing is measured as visible at all (transient during fast updates), keep
        // the previous active marker instead of jumping to an endpoint.
        if (next.size === 0) {
            const userItems = loadedUserMessagesRef.current;
            if (userItems.length > 0 && visibleIndexes.length > 0) {
                const centerIndex = visibleIndexes.reduce((sum, index) => sum + index, 0) / visibleIndexes.length;
                let nearest = userItems[0];
                let nearestDistance = Math.abs(nearest.index - centerIndex);
                for (const userItem of userItems) {
                    const distance = Math.abs(userItem.index - centerIndex);
                    if (distance < nearestDistance) {
                        nearest = userItem;
                        nearestDistance = distance;
                    }
                }
                next.add(nearest.message.id);
            } else {
                const validIds = new Set(userItems.map((item) => item.message.id));
                for (const id of activeMessageIdsRef.current) {
                    if (validIds.has(id)) {
                        next.add(id);
                    }
                }
            }
        }

        if (next.size > 0 || loadedUserMessagesRef.current.length === 0) {
            activeMessageIdsRef.current = next;
            onActiveMessageIdsChangeRef.current?.(next);
        }
    }, []);

    const ensureIntersectionObserver = useCallback(() => {
        if (intersectionObserverRef.current || !scrollerElRef.current || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const id = (entry.target as HTMLElement).dataset.chatMsgId;
                if (!id) continue;
                if (entry.isIntersecting) {
                    visibleIdsRef.current.add(id);
                } else {
                    visibleIdsRef.current.delete(id);
                }
            }
            recomputeActiveIds();
        }, { root: scrollerElRef.current, threshold: 0.1 });
        intersectionObserverRef.current = observer;
        for (const el of rowElsByKeyRef.current.values()) {
            observer.observe(el);
        }
    }, [recomputeActiveIds]);

    // Stable per-message ref callbacks so React only invokes them on real
    // mount/unmount (an inline closure would detach/re-attach every render).
    const rowRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
    const getRowRefCallback = useCallback((messageId: string) => {
        let callback = rowRefCallbacksRef.current.get(messageId);
        if (!callback) {
            callback = (el: HTMLDivElement | null) => {
                const prev = rowElsByKeyRef.current.get(messageId);
                if (el) {
                    el.dataset.chatMsgId = messageId;
                    if (prev !== el) {
                        if (prev) {
                            intersectionObserverRef.current?.unobserve(prev);
                            rowResizeObserverRef.current?.unobserve(prev);
                            keyByElementRef.current.delete(prev);
                        }
                        rowElsByKeyRef.current.set(messageId, el);
                        keyByElementRef.current.set(el, messageId);
                        pendingFirstMeasureRef.current.set(messageId, el);
                        ensureIntersectionObserver();
                        const ro = ensureRowResizeObserver();
                        intersectionObserverRef.current?.observe(el);
                        ro?.observe(el);
                    }
                } else if (prev) {
                    intersectionObserverRef.current?.unobserve(prev);
                    rowResizeObserverRef.current?.unobserve(prev);
                    keyByElementRef.current.delete(prev);
                    rowElsByKeyRef.current.delete(messageId);
                    pendingFirstMeasureRef.current.delete(messageId);
                    // The measured height stays in the cache — that's the point.
                    if (visibleIdsRef.current.delete(messageId)) {
                        recomputeActiveIds();
                    }
                }
            };
            rowRefCallbacksRef.current.set(messageId, callback);
        }
        return callback;
    }, [ensureIntersectionObserver, recomputeActiveIds]);

    // ---- Scroll / input listeners ----

    const handleScrollRef = useRef<() => void>(() => { });
    handleScrollRef.current = () => {
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        const raw = Math.abs(scroller.scrollTop);
        const atBottom = raw <= SCROLL_THRESHOLD;
        atBottomRef.current = atBottom;
        visibilityControllerRef.current?.update(!atBottom);
        rememberSessionRestoreState(props.sessionId, {
            scrollDistancePx: raw,
            atBottom,
            // Heights/window are captured on unmount; scroll events only keep
            // the cheap fields fresh.
            heightsByKey: sessionRestoreStates.get(props.sessionId)?.heightsByKey ?? {},
            renderedWindow: sessionRestoreStates.get(props.sessionId)?.renderedWindow ?? null,
        });
        updateViewportRef.current(raw, scroller.clientHeight);
    };

    const detachScrollerListenersRef = useRef<(() => void) | null>(null);
    const scrollerResizeObserverRef = useRef<ResizeObserver | null>(null);
    const handleScrollerEl = useCallback((el: HTMLDivElement | null) => {
        if (scrollerElRef.current === el) return;
        detachScrollerListenersRef.current?.();
        detachScrollerListenersRef.current = null;
        scrollerResizeObserverRef.current?.disconnect();
        scrollerResizeObserverRef.current = null;
        scrollerElRef.current = el;
        if (el) {
            const onScroll = () => handleScrollRef.current();
            const onUserInput = () => {
                lastUserInputAtRef.current = performance.now();
                // The user takes over: any pending restore or animation yields.
                pendingRestoreRef.current = null;
                cancelScrollAnimation();
            };
            el.addEventListener('scroll', onScroll, { passive: true });
            el.addEventListener('wheel', onUserInput, { passive: true });
            el.addEventListener('touchstart', onUserInput, { passive: true });
            el.addEventListener('pointerdown', onUserInput, { passive: true });
            detachScrollerListenersRef.current = () => {
                el.removeEventListener('scroll', onScroll);
                el.removeEventListener('wheel', onUserInput);
                el.removeEventListener('touchstart', onUserInput);
                el.removeEventListener('pointerdown', onUserInput);
            };
            if (typeof ResizeObserver !== 'undefined') {
                const observer = new ResizeObserver(() => {
                    updateViewportRef.current(Math.abs(el.scrollTop), el.clientHeight);
                    reassertPendingRestoreRef.current();
                });
                observer.observe(el);
                scrollerResizeObserverRef.current = observer;
            }
        }
        if (intersectionObserverRef.current) {
            intersectionObserverRef.current.disconnect();
            intersectionObserverRef.current = null;
            visibleIdsRef.current.clear();
        }
        ensureIntersectionObserver();
    }, [ensureIntersectionObserver]);

    // Footer block at the content bottom: its height is the raw↔model offset,
    // and its growth below a scrolled-up viewport must be compensated (at the
    // bottom, scrollTop 0 tracks it structurally).
    const footerResizeObserverRef = useRef<ResizeObserver | null>(null);
    const handleFooterEl = useCallback((el: HTMLDivElement | null) => {
        footerResizeObserverRef.current?.disconnect();
        footerResizeObserverRef.current = null;
        if (!el) return;
        footerHeightRef.current = el.offsetHeight;
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            const height = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
            const prev = footerHeightRef.current;
            footerHeightRef.current = height;
            const delta = height - prev;
            if (delta === 0 || isAnimatingScrollRef.current) return;
            const scroller = scrollerElRef.current;
            if (!scroller || atBottomRef.current || pendingRestoreRef.current != null) return;
            setRawDistance(Math.abs(scroller.scrollTop) + delta);
        });
        observer.observe(el);
        footerResizeObserverRef.current = observer;
    }, []);

    // ---- Background history drain (Codex: loadRemainingConversationTurns) ----
    // Pages the entire history into memory, one page per commit (each page's
    // commit re-triggers the effect, which naturally yields to the UI between
    // pages). Prepends land above the viewport — bottom-anchored coordinates
    // don't move, so this is invisible. A page that resolves without moving
    // oldestSeq (transient failure) is retried after a short delay, but only a
    // few times — a persistent stall must degrade (minimap stays hidden), not
    // hammer the backend forever. Any later store change re-arms the drain.
    const [drainRetryNonce, setDrainRetryNonce] = useState(0);
    const drainRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const drainNoProgressCountRef = useRef(0);
    React.useEffect(() => {
        if (!props.hasMore || !props.onLoadMore || isLoadingMoreRef.current) return;
        const oldestBefore = storage.getState().sessionMessages[sessionIdRef.current]?.oldestSeq ?? null;
        isLoadingMoreRef.current = true;
        Promise.resolve(props.onLoadMore()).finally(() => {
            isLoadingMoreRef.current = false;
            const stateAfter = storage.getState().sessionMessages[sessionIdRef.current];
            const madeProgress = !stateAfter || stateAfter.hasMore === false
                || (stateAfter.oldestSeq ?? null) !== oldestBefore;
            if (madeProgress) {
                drainNoProgressCountRef.current = 0;
            } else {
                drainNoProgressCountRef.current += 1;
                if (drainNoProgressCountRef.current > DRAIN_MAX_NO_PROGRESS_RETRIES) {
                    if (__DEV__) {
                        console.warn('[ChatList] history drain made no progress; pausing until data changes');
                    }
                    return;
                }
            }
            if (drainRetryTimerRef.current != null) clearTimeout(drainRetryTimerRef.current);
            drainRetryTimerRef.current = setTimeout(() => {
                drainRetryTimerRef.current = null;
                if (storage.getState().sessionMessages[sessionIdRef.current]?.hasMore) {
                    setDrainRetryNonce((n) => n + 1);
                }
            }, 1000);
        });
    }, [props.hasMore, props.onLoadMore, props.messages, drainRetryNonce]);
    React.useEffect(() => () => {
        if (drainRetryTimerRef.current != null) clearTimeout(drainRetryTimerRef.current);
    }, []);

    // ---- Jump to a minimap prompt ----

    const flashRowHighlight = (key: string) => {
        const el = rowElsByKeyRef.current.get(key);
        if (!el || typeof el.animate !== 'function') return;
        const reducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.animate(
            [
                { backgroundColor: theme.colors.surfaceHighest },
                { backgroundColor: theme.colors.surfaceHighest, offset: 0.35 },
                { backgroundColor: 'transparent' },
            ],
            { duration: reducedMotion ? 0 : HIGHLIGHT_DURATION_MS, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
    };

    const jumpNonceRef = useRef(0);
    // Start a jump for a target that is in memory. Mounted target → Codex-style
    // smooth scroll (scroll-padding-top keeps it below the floating header);
    // unmounted → teleport the window and position instantly from the model.
    const startJump = (target: UserTextMessage): boolean => {
        const message = visibleMessagesRef.current.find((m) => messageMatchesTarget(m, target));
        if (!message) return false;
        cancelScrollAnimation();
        pendingRestoreRef.current = null;
        const el = rowElsByKeyRef.current.get(message.id);
        if (el && pendingJumpRef.current == null) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            flashRowHighlight(message.id);
            return true;
        }
        const jump: PendingJump = { key: message.id, nonce: ++jumpNonceRef.current };
        pendingJumpRef.current = jump;
        setPendingJump(jump);
        return true;
    };
    const startJumpRef = useRef(startJump);
    startJumpRef.current = startJump;

    // The target of the in-flight jump. A second minimap click updates this so
    // a waiting jump retargets instead of the click being silently dropped.
    const activeJumpTargetRef = useRef<UserTextMessage | null>(null);
    const isJumpWaitLoopRunningRef = useRef(false);
    const handleJumpToMessage = useCallback(async (target: UserTextMessage) => {
        activeJumpTargetRef.current = target;
        if (isJumpWaitLoopRunningRef.current) return;
        if (startJumpRef.current(target)) return;
        // Not in memory yet — the minimap is normally gated on the full history
        // being loaded, so this only happens for jumps arriving mid-drain. The
        // background drain is already paging; just wait for the target.
        isJumpWaitLoopRunningRef.current = true;
        setIsLocating(true);
        try {
            const MAX_WAIT_MS = 30_000;
            const startedAt = performance.now();
            while (performance.now() - startedAt < MAX_WAIT_MS) {
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                const current = activeJumpTargetRef.current;
                if (!current) return;
                if (startJumpRef.current(current)) return;
                const state = storage.getState().sessionMessages[sessionIdRef.current];
                if (!state || !state.hasMore) {
                    startJumpRef.current(current);
                    return;
                }
            }
        } finally {
            isJumpWaitLoopRunningRef.current = false;
            setIsLocating(false);
        }
    }, []);

    // ---- Render-phase window overrides ----
    // A pending jump mounts its target in the SAME commit that requested it;
    // an entry-set change remaps the window to follow its anchor key (indices
    // shift on prepends).
    let renderedRange: RenderRange = viewport.renderedRange;
    if (pendingJump != null) {
        const centerDistance = distanceToCenterEntry({ layout, key: pendingJump.key, viewportHeightPx: viewport.viewportHeightPx });
        if (centerDistance != null) {
            renderedRange = computeVisibleRange({
                layout,
                distanceFromBottomPx: centerDistance,
                viewportHeightPx: viewport.viewportHeightPx,
                overscanCount: OVERSCAN_ROWS,
            });
        }
    } else if (!sameKeys(viewport.keys, layout.keys)) {
        const anchorKey = viewport.keys[viewport.renderedRange.startIndex];
        if (anchorKey != null) {
            renderedRange = rangeAroundAnchor({ layout, anchorKey, previousRange: renderedRange }) ?? renderedRange;
        }
    }
    renderedRange = {
        startIndex: Math.min(renderedRange.startIndex, layout.keys.length),
        endIndex: Math.min(renderedRange.endIndex, layout.keys.length),
    };

    // ---- Layout effects (all pre-paint) ----
    // Order matters: the entry-set compensation must run BEFORE the first-
    // measurement sweep. When one commit both appends entries and mounts them,
    // the append shift (at estimated size) is compensated first; the
    // measurement pass then refines real−estimate on the corrected scroll.

    // 1. Entry-set changes (new message, page prepend): keep the first
    // measured on-screen row's top edge still. Prepends are naturally free in
    // bottom-anchored coordinates (delta 0); appends below a scrolled-up
    // viewport get compensated; at the bottom, glue to 0.
    React.useLayoutEffect(() => {
        const previous = committedLayoutRef.current;
        const next = preMeasureLayoutRef.current ?? layout;
        preMeasureLayoutRef.current = null;
        committedLayoutRef.current = layout;
        if (pendingOpsRef.current || pendingJumpRef.current || previous === next) return;
        const scroller = scrollerElRef.current;
        if (!scroller || pendingRestoreRef.current != null || isAnimatingScrollRef.current) return;
        const raw = Math.abs(scroller.scrollTop);
        if (atBottomRef.current) {
            const withinGrace = performance.now() - lastUserInputAtRef.current < USER_SCROLL_GRACE_MS;
            if (raw !== 0 && !withinGrace) setRawDistance(0);
            return;
        }
        const model = toModelDistance(raw);
        const anchorKey = pickCompensationAnchor({
            previousLayout: previous,
            nextLayout: next,
            distanceFromBottomPx: model,
            viewportHeightPx: scroller.clientHeight,
            measuredHeightsByKey: measuredHeightsRef.current,
        });
        if (!anchorKey) return;
        const compensatedModel = compensatedDistanceFromBottom({
            anchorKey,
            distanceFromBottomPx: model,
            previousLayout: previous,
            nextLayout: next,
        });
        if (compensatedModel == null || compensatedModel === model) return;
        setRawDistance(Math.max(0, raw + (compensatedModel - model)));
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
    }, [layout]);

    // 2. Synchronous first measurement of rows mounted this commit. Reading
    // offsetHeight here (pre-paint) feeds real sizes into the model before the
    // user can ever see the constrained placeholder.
    React.useLayoutEffect(() => {
        const pending = pendingFirstMeasureRef.current;
        if (pending.size === 0) return;
        pendingFirstMeasureRef.current = new Map();
        const batch = new Map<string, { element: HTMLElement; heightPx: number }>();
        for (const [key, el] of pending) {
            if (rowElsByKeyRef.current.get(key) !== el) continue;
            const height = el.offsetHeight;
            if (height > 0) batch.set(key, { element: el, heightPx: height });
        }
        if (batch.size > 0 && applyMeasuredHeightsRef.current(batch, false)) {
            // A commit was staged: queue everything for one verification pass
            // after it lands (sizes can settle across the relayout).
            for (const [key, el] of pending) {
                if (rowElsByKeyRef.current.get(key) === el) {
                    pendingFirstMeasureRef.current.set(key, el);
                }
            }
        }
    });

    // 3. Drain staged measurement ops: apply the scroll correction (or
    // re-assert a pending restore) right after the commit, before paint.
    React.useLayoutEffect(() => {
        const ops = pendingOpsRef.current;
        if (!ops || ops.heights !== measuredHeights) return;
        pendingOpsRef.current = null;
        if (ops.restore) {
            reassertPendingRestoreRef.current();
        } else if (ops.scrollDistancePx != null && !isAnimatingScrollRef.current) {
            setRawDistance(ops.scrollDistancePx);
        }
    }, [measuredHeights]);

    // 4. Commit the render-phase window remap after entry-set changes and
    // re-assert a pending restore (more content may make it reachable now).
    React.useLayoutEffect(() => {
        if (pendingJumpRef.current) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        if (!pendingOpsRef.current) reassertPendingRestoreRef.current();
    }, [entryKeys]);

    // 5. Initial mount: apply the saved scroll offset before first paint, once
    // the scroller exists (the empty gate can delay it past mount).
    const didInitialScrollRef = useRef(false);
    React.useLayoutEffect(() => {
        if (didInitialScrollRef.current) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        didInitialScrollRef.current = true;
        if (pendingRestoreRef.current != null) {
            reassertPendingRestoreRef.current();
        }
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
    });

    // 6. Execute a pending jump: the render override above already mounted the
    // target; re-measure everything mounted synchronously, then position the
    // target from the (now exact for mounted rows) model — instantly.
    React.useLayoutEffect(() => {
        const jump = pendingJump;
        if (!jump) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        const batch = new Map<string, { element: HTMLElement; heightPx: number }>();
        for (const [key, el] of rowElsByKeyRef.current) {
            const height = el.offsetHeight;
            if (height > 0) batch.set(key, { element: el, heightPx: height });
        }
        // If measuring staged a commit, wait for it — this effect re-runs with
        // the rebuilt layout (deps) and positions against exact heights.
        if (applyMeasuredHeightsRef.current(batch, false) || pendingOpsRef.current) return;
        const modelDistance = distanceToAlignEntryTop({
            layout,
            key: jump.key,
            viewportHeightPx: scroller.clientHeight,
            topInsetPx: headerInsetPx + JUMP_TOP_MARGIN_PX,
        });
        const clearJump = () => queueMicrotask(() => {
            if (pendingJumpRef.current === jump) pendingJumpRef.current = null;
            setPendingJump((current) => (current === jump ? null : current));
        });
        if (modelDistance == null) {
            clearJump();
            return;
        }
        const raw = modelDistance === 0 ? 0 : modelDistance + footerHeightRef.current;
        setRawDistance(raw);
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        flashRowHighlight(jump.key);
        if (__DEV__) {
            console.log('[ChatList] jump landed', { key: jump.key, raw: Math.round(raw) });
        }
        clearJump();
    });

    // ---- Plumbing effects ----

    React.useEffect(() => {
        props.onRegisterMinimapJump?.(handleJumpToMessage);
        return () => props.onRegisterMinimapJump?.(null);
    }, [props.onRegisterMinimapJump, handleJumpToMessage]);

    React.useEffect(() => {
        props.onMinimapItemsChange?.(minimapItems);

        const validIds = new Set(minimapItems.map((item) => item.message.id));
        const stillValidActiveIds = Array.from(activeMessageIdsRef.current).filter((id) => validIds.has(id));
        if (stillValidActiveIds.length > 0) {
            const next = new Set(stillValidActiveIds);
            activeMessageIdsRef.current = next;
            props.onActiveMessageIdsChange?.(next);
            return;
        }

        const fallback = minimapItems[minimapItems.length - 1];
        const next = fallback ? new Set([fallback.message.id]) : new Set<string>();
        activeMessageIdsRef.current = next;
        props.onActiveMessageIdsChange?.(next);
    }, [props.onMinimapItemsChange, props.onActiveMessageIdsChange, minimapItems]);

    React.useEffect(() => {
        const controller = createScrollButtonVisibilityController({
            showDelayMs: SHOW_SCROLL_BUTTON_DELAY_MS,
            onShow: () => {
                setShowScrollButton((prev) => {
                    if (prev) return prev;
                    lastSeenTimestampRef.current = visibleMessagesRef.current[0]?.createdAt ?? 0;
                    return true;
                });
            },
            onHide: () => {
                setShowScrollButton(false);
            },
        });

        visibilityControllerRef.current = controller;
        // A restored mid-history position starts away from the bottom without
        // any scroll event — seed the controller so the button appears.
        controller.update(!atBottomRef.current);
        return () => {
            controller.dispose();
            visibilityControllerRef.current = null;
        };
    }, []);

    // Final restore-state save + observer teardown. Scroll events keep the
    // cheap fields fresh; the height cache and window anchor are captured here.
    React.useEffect(() => () => {
        cancelScrollAnimation();
        const scroller = scrollerElRef.current;
        const vp = viewportRef.current;
        const anchorKey = vp.keys[vp.renderedRange.startIndex] ?? null;
        const keySet = new Set(vp.keys);
        const heightsByKey: Record<string, number> = {};
        for (const [key, height] of Object.entries(measuredHeightsRef.current)) {
            if (keySet.has(key)) heightsByKey[key] = height;
        }
        rememberSessionRestoreState(sessionIdRef.current, {
            scrollDistancePx: scroller ? Math.abs(scroller.scrollTop) : vp.distanceFromBottomPx + footerHeightRef.current,
            atBottom: atBottomRef.current,
            heightsByKey,
            renderedWindow: anchorKey
                ? { anchorKey, count: vp.renderedRange.endIndex - vp.renderedRange.startIndex }
                : null,
        });
        intersectionObserverRef.current?.disconnect();
        intersectionObserverRef.current = null;
        rowResizeObserverRef.current?.disconnect();
        rowResizeObserverRef.current = null;
        scrollerResizeObserverRef.current?.disconnect();
        scrollerResizeObserverRef.current = null;
        footerResizeObserverRef.current?.disconnect();
        footerResizeObserverRef.current = null;
    }, []);

    // Codex-style animated scroll to bottom (cubic ease-out, ~260ms), aborted
    // by any user input. Measurement compensations are suppressed while it
    // runs — the destination is the bottom, they'd be overwritten anyway.
    const handleScrollToBottom = useCallback(() => {
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        pendingRestoreRef.current = null;
        cancelScrollAnimation();
        const start = Math.abs(scroller.scrollTop);
        if (start <= RESTORE_TOLERANCE_PX) {
            setRawDistance(0);
            return;
        }
        isAnimatingScrollRef.current = true;
        const startedAt = performance.now();
        const step = (now: number) => {
            const el = scrollerElRef.current;
            if (!el) {
                cancelScrollAnimation();
                return;
            }
            const progress = Math.min(1, (now - startedAt) / SCROLL_TO_BOTTOM_ANIMATION_MS);
            const eased = 1 - (1 - progress) ** 3;
            el.scrollTop = -(start * (1 - eased));
            if (progress < 1 && Math.abs(el.scrollTop) > 1) {
                scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
            } else {
                el.scrollTop = 0;
                atBottomRef.current = true;
                cancelScrollAnimation();
            }
        };
        scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
    }, []);

    // ---- Render ----

    const scrollerStyle = React.useMemo(() => ({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column-reverse',
        // The viewport-stability math here is bottom-anchored and self-contained;
        // browser scroll anchoring (partially implemented for reverse flex) would
        // only fight it.
        overflowAnchor: 'none',
        // Programmatic scrolls must stay instant even if a global stylesheet turns
        // on smooth scrolling.
        scrollBehavior: 'auto',
        // Smooth scrollIntoView (mounted jump targets) lands below the floating header.
        scrollPaddingTop: headerInsetPx + JUMP_TOP_MARGIN_PX,
    } as React.CSSProperties), [headerInsetPx]);

    const rows: React.ReactNode[] = [];
    for (let entryIndex = renderedRange.startIndex; entryIndex < renderedRange.endIndex; entryIndex++) {
        const messageIndex = visibleMessages.length - 1 - entryIndex;
        const item = visibleMessages[messageIndex];
        if (!item) continue;
        // Agent turns show the action bar only on their last text segment;
        // user messages always show it.
        const showActionBar = item.kind === 'agent-text'
            ? lastAgentSegmentIds.has(item.id)
            : true;
        // Fork is offered on user prompts and on AI replies (private sessions
        // only; agent replies only via their action-bar segment).
        const canFork = !!props.onForkMessage && !props.isSharedSession
            && (item.kind === 'user-text' || (item.kind === 'agent-text' && showActionBar));
        const isNewestMessage = messageIndex === 0;
        // Never-measured rows mount height-constrained to the model estimate so
        // mounting can't shift anything; the newest message (streams/grows) and
        // the jump target (positioned from its real size) render natural.
        const constrainedHeightPx = !isNewestMessage && pendingJump?.key !== item.id && measuredHeights[item.id] == null
            ? layout.heightsPx[entryIndex]
            : undefined;
        rows.push(
            <ChatRow
                key={item.id}
                message={item}
                metadata={props.metadata}
                sessionId={props.sessionId}
                isNewestMessage={isNewestMessage}
                onFillInput={props.onFillInput}
                onForkMessage={canFork ? props.onForkMessage : undefined}
                forkTarget={item.kind === 'agent-text' ? (forkTargetsById.get(item.id) ?? null) : null}
                showActionBar={showActionBar}
                forkLoading={!!props.forkingMessageId && props.forkingMessageId === item.id}
                isSharedSession={props.isSharedSession}
                currentUserId={props.currentUserId}
                showSenderName={senderVisibility?.get(item.id) ?? false}
                constrainedHeightPx={constrainedHeightPx}
                refCallback={getRowRefCallback(item.id)}
            />
        );
    }

    return (
        <View style={{ flex: 1 }}>
            {visibleMessages.length === 0 ? (
                // No rows to render yet — show the paging spinner centered (the
                // session-level first-load spinner lives in SessionView).
                <View style={{ flex: 1 }}>
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        {props.hasMore && (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        )}
                    </View>
                    <ListFooter sessionId={props.sessionId} />
                </View>
            ) : (
                // column-reverse scroller with a SINGLE normal-order child:
                // header spacer, older-pages spinner, the virtualized window
                // inside a fixed-height container, footer (visual bottom).
                <div ref={handleScrollerEl} style={scrollerStyle}>
                    <div style={contentColumnStyle}>
                        <div style={{ height: headerInsetPx, flexShrink: 0 }} />
                        {props.hasMore && (
                            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            </View>
                        )}
                        <div style={{ height: layout.totalHeightPx, flexShrink: 0 }}>
                            <div style={{ ...windowColumnStyle, marginTop: layout.topOffsetsPx[renderedRange.startIndex] ?? 0 }}>
                                {rows}
                            </div>
                        </div>
                        <div ref={handleFooterEl} style={{ flexShrink: 0 }}>
                            <ListFooter sessionId={props.sessionId} />
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom-centered hint shown while a jump waits for history to drain in */}
            {isLocating && (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                    }}
                >
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.surfaceHighest,
                            borderRadius: 20,
                            paddingHorizontal: 14,
                            height: 36,
                            shadowColor: theme.colors.shadow.color,
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: theme.colors.shadow.opacity,
                            shadowRadius: 4,
                            elevation: 4,
                        }}
                    >
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={{ marginLeft: 8, color: theme.colors.text, fontSize: 14 }}>
                            {t('session.locatingMessage')}
                        </Text>
                    </View>
                </View>
            )}

            {/* Scroll to bottom button - positioned relative to content area */}
            {showScrollButton && (
                <View
                    pointerEvents="box-none"
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                    }}
                >
                    <View
                        pointerEvents="box-none"
                        style={{
                            width: '100%',
                            maxWidth: appLayout.maxWidth,
                            alignItems: 'flex-end',
                            paddingRight: 16,
                        }}
                    >
                        <Pressable
                            onPress={handleScrollToBottom}
                            style={{
                                backgroundColor: theme.colors.surfaceHighest,
                                borderRadius: 20,
                                width: 40,
                                height: 40,
                                alignItems: 'center',
                                justifyContent: 'center',
                                shadowColor: theme.colors.shadow.color,
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: theme.colors.shadow.opacity,
                                shadowRadius: 4,
                                elevation: 4,
                            }}
                        >
                            <Ionicons name="chevron-down" size={24} color={theme.colors.text} />
                            {unreadCount > 0 && (
                                <View style={{
                                    position: 'absolute',
                                    top: -4,
                                    right: -4,
                                    backgroundColor: theme.colors.status.connected,
                                    borderRadius: 10,
                                    minWidth: 20,
                                    height: 20,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    paddingHorizontal: 4,
                                }}>
                                    <Text style={{
                                        color: '#fff',
                                        fontSize: 12,
                                        fontWeight: '600',
                                    }}>
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    )
});
