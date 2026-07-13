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
    computeVisibleRange,
    desiredTopSlackPx,
    distanceToAlignEntryTop,
    distanceToCenterEntry,
    entryTopFromBottom,
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
//    CSSOM), so first-paint-at-bottom and stick-to-bottom are structural. All
//    code below works in distance-from-bottom pixels (= |scrollTop|).
//
// 2. A windowed virtualizer driven by a pure layout model
//    (chatListVirtualModel.ts): per-message measured/estimated heights →
//    prefix sums → binary-searched render range. Only the visible window
//    (± overscan) is mounted; the window sits inside an explicit-height CANVAS
//    positioned by a single marginTop spacer, so rows stay in real document
//    flow. Freshly mounted, never-measured rows are height-CONSTRAINED to
//    their model height (overflow hidden) so mounting cannot shift layout;
//    a pre-paint measurement pass then feeds real sizes back into the model.
//    All corrections happen before paint (ResizeObserver callbacks and layout
//    effects both run pre-paint).
//
// 3. FROZEN scroll geometry while the user is scrolling. Engines disagree on
//    which offset to preserve when scrollHeight changes mid-gesture: some keep
//    the distance-from-bottom (column-reverse's promise), others keep the
//    distance-from-top and deliver the difference 1-2 frames later as a
//    spontaneous scroll event — a visible jump that no after-the-fact
//    compensation can reliably cancel (it races the user's own input; Codex
//    desktop suffers the same jump). So while a wheel / key / momentum gesture
//    is in flight this component never mutates the scroller's geometry:
//      - the canvas keeps TOP SLACK (empty px above the content top), so
//        growth above the viewport — page prepends, corrections of estimated
//        rows entering from the top — moves the window's marginTop inside the
//        constant-height canvas instead of resizing it;
//      - growth below the viewport is absorbed by canvasBottomOffsetPx, the
//        model coordinate of the canvas's bottom edge (content that grows
//        "below the canvas" stays virtual until it could become visible);
//      - `overflow: clip` on the canvas guarantees transient window overflow
//        can never leak into scrollHeight.
//    When scrolling goes quiet (scrollend / input+scroll silence) one
//    renormalization re-syncs the canvas height, zeroes the bottom offset and
//    rewrites scrollTop equivalently (screen-invariant), then re-asserts the
//    write once if the engine moves it asynchronously — safe at idle, where
//    there is no in-flight input to swallow. Forced renormalizations happen
//    only when the viewport approaches a region the frozen canvas cannot
//    represent (its clipped bottom, its top edge, or slack blank above a
//    fully-loaded top).
//
// 4. On-demand history loading (FlatList-era policy): opening a session loads
//    only the latest page; older pages load when the viewport nears the
//    visual top of loaded content. The minimap appears immediately, merging
//    loaded prompts with the offline prompt cache; jumping to a not-yet-loaded
//    prompt pages older history in (with a "locating" hint) before the jump
//    resolves. Prepends land above the viewport — bottom-anchored coordinates
//    don't move, so paging is invisible.
//
// 5. Per-session restore: measured heights, the rendered window anchor and
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
            minimapCachedUserMessages={props.minimapCachedUserMessages}
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
// Codex-style animated "scroll to bottom" (cubic ease-out).
const SCROLL_TO_BOTTOM_ANIMATION_MS = 260;
// Animate scroll-to-bottom only within this many viewports of the bottom.
// Farther away the fixed-duration animation is a meaningless whoosh (hundreds
// of px per frame, each frame a window slide); teleport instantly instead,
// like a minimap jump.
const SCROLL_TO_BOTTOM_ANIMATE_MAX_VIEWPORTS = 3;
// Viewport height guess used before the scroller is measured.
const INITIAL_VIEWPORT_GUESS_PX = 800;
// A pending scroll restore is considered landed within this tolerance.
const RESTORE_TOLERANCE_PX = 24;
// Start loading the next older page when the viewport gets this close to the
// visual top of the loaded content.
const LOAD_MORE_DISTANCE_PX = 800;
// ---- Frozen-geometry parameters (architecture note 3) ----
// Empty canvas px kept above the content top as growth headroom. Must cover a
// whole prepended page at estimate size (~page × estimate) plus the
// measurement corrections of one scroll burst, or fast upward scrolling forces
// mid-gesture renormalizations at every page boundary.
const TOP_SLACK_PX = 12_000;
// Scrolling counts as in-flight until both input and scroll events have been
// quiet this long; renormalization waits it out (or a scrollend event).
const GESTURE_QUIET_MS = 160;
const RENORM_TICK_MS = 90;
// Our own scrollTop writes are re-asserted once if the engine asynchronously
// re-derives them within this window — dropped as soon as newer user input
// exists, so the re-assert can never swallow scrolling.
const WRITE_VERIFY_WINDOW_MS = 120;
const WRITE_VERIFY_TOLERANCE_PX = 4;
// A scroll event this close (time and px) to our own last write is the echo
// of that write, not user scrolling.
const SELF_ECHO_WINDOW_MS = 120;
// Re-check the load-more trigger this often after a load completes — a load
// with no (or not-yet-visible) progress otherwise strands a motionless
// viewport with nothing left to re-fire the trigger.
const LOAD_MORE_RETRY_MS = 300;
// A gesture that ends with the viewport more than this far above the loaded
// content top (inside the blank slack band) snaps to the content top…
const BAND_SNAP_THRESHOLD_PX = 100;
// …leaving this much band visible so the paging spinner shows.
const BAND_PEEK_PX = 72;
// Keys the browser turns into native scrolling of the hovered/focused scroller.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
// Post-jump feedback: horizontal shake on the target row.
const SHAKE_DURATION_MS = 600;
const SHAKE_DELAY_MS = 200;
const SHAKE_KEYFRAMES: Keyframe[] = [
    { transform: 'translate3d(0, 0, 0)', offset: 0 },
    { transform: 'translate3d(-1px, 0, 0)', offset: 0.1 },
    { transform: 'translate3d(2px, 0, 0)', offset: 0.2 },
    { transform: 'translate3d(-4px, 0, 0)', offset: 0.3 },
    { transform: 'translate3d(4px, 0, 0)', offset: 0.4 },
    { transform: 'translate3d(-4px, 0, 0)', offset: 0.5 },
    { transform: 'translate3d(4px, 0, 0)', offset: 0.6 },
    { transform: 'translate3d(-4px, 0, 0)', offset: 0.7 },
    { transform: 'translate3d(2px, 0, 0)', offset: 0.8 },
    { transform: 'translate3d(-1px, 0, 0)', offset: 0.9 },
    { transform: 'translate3d(0, 0, 0)', offset: 1 },
];

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

const scrollerStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflowY: 'auto',
    // Clips the shake feedback's ±4px horizontal excursion (with overflow-y
    // auto, a visible x-axis would compute to auto and flash a scrollbar).
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column-reverse',
    // The viewport-stability math here is bottom-anchored and self-contained;
    // browser scroll anchoring (partially implemented for reverse flex) would
    // only fight it.
    overflowAnchor: 'none',
    // Programmatic scrolls must stay instant even if a global stylesheet turns
    // on smooth scrolling.
    scrollBehavior: 'auto',
    // The native bar would render the canvas's top slack as phantom scroll
    // range; the PROXY scrollbar next to the scroller shows the honest loaded
    // height instead (see the proxy-scrollbar section).
    scrollbarWidth: 'none',
} as React.CSSProperties;

// ::-webkit-scrollbar has no inline-style equivalent (needed for WebKit
// engines that ignore scrollbar-width).
const SCROLLBAR_HIDE_CLASS = 'chatlist-hide-native-scrollbar';
let scrollbarHideStyleInjected = false;
function ensureScrollbarHideStyle() {
    if (scrollbarHideStyleInjected || typeof document === 'undefined') return;
    scrollbarHideStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `.${SCROLLBAR_HIDE_CLASS}::-webkit-scrollbar{display:none;}`;
    document.head.appendChild(style);
}

// The proxy scrollbar: a narrow native scroller overlaying the right edge
// whose only child is an invisible ghost sized to the HONEST loaded content
// height (header inset + model total + footer — no canvas slack). Its native
// scrollbar is the one the user sees; positions sync both ways in
// content-space, so canvas slack and the frozen bottom offset never distort
// the thumb. Proxy drags also route through our coordinate math instead of
// letting the engine steer a scroller whose range includes phantom space.
const proxyScrollerStyle = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    scrollBehavior: 'auto',
    zIndex: 1,
} as React.CSSProperties;

// Native scrollbar width varies (Windows classic ~17px, Linux ~15px, overlay
// engines 0): a fixed strip would clip a wider classic bar. Probe it once;
// overlay bars measure 0 and fall back to a hover-friendly minimum.
const PROXY_MIN_WIDTH_PX = 14;
let measuredScrollbarWidthPx: number | null = null;
function proxyStripWidthPx(): number {
    if (measuredScrollbarWidthPx == null) {
        if (typeof document === 'undefined' || !document.body) return PROXY_MIN_WIDTH_PX;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;';
        document.body.appendChild(probe);
        measuredScrollbarWidthPx = probe.offsetWidth - probe.clientWidth;
        probe.remove();
    }
    return Math.max(measuredScrollbarWidthPx, PROXY_MIN_WIDTH_PX);
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

type PendingJump = {
    key: string;
    nonce: number;
    // 'center': minimap jump. 'top': internal band snap (viewport top lands
    // at the entry's top edge plus the spinner peek).
    align: 'center' | 'top';
    // Internal repositions skip the shake feedback and logging.
    silent: boolean;
};
type PendingMeasureOps = {
    // While a session restore is pending, measurement batches re-assert the
    // saved offset instead of compensating (the saved offset IS the truth).
    restore: boolean;
    // Glue the viewport back to the bottom after the commit (streaming follow).
    pinToBottom: boolean;
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
    minimapCachedUserMessages?: UserTextMessage[],
    onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void,
    onActiveMessageIdsChange?: (ids: Set<string>) => void,
    onRegisterMinimapJump?: (jump: ((message: UserTextMessage) => void) | null) => void,
}) => {
    const { theme } = useUnistyles();
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    ensureScrollbarHideStyle();
    // The floating header overlays the scroller top; the top spacer keeps the
    // oldest content readable beneath it.
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

    // Merge offline-cached user messages with the loaded ones so the minimap can show prompts that
    // live in the persistent cache but haven't been paged into the list yet. Loaded messages win on
    // id (they carry an accurate scroll position); compaction markers are hidden to match the list.
    const minimapItems = React.useMemo<ConversationMinimapItem[]>(() => {
        // Loaded messages always win (they carry the store's id → accurate scroll position + active
        // highlight). A cached entry is dropped if a loaded message matches it by EITHER seq OR
        // localId: the same message can be represented differently on each side (e.g. loaded is the
        // just-sent optimistic copy with a localId and no seq, cache has the acked copy with a seq),
        // so a single-key match would leak duplicates.
        const loadedBySeq = new Set<number>();
        const loadedByLocalId = new Set<string>();
        const merged: UserTextMessage[] = [];
        for (const loaded of loadedUserMessages) {
            merged.push(loaded.message);
            if (loaded.message.seq != null) loadedBySeq.add(loaded.message.seq);
            if (loaded.message.localId) loadedByLocalId.add(loaded.message.localId);
        }
        for (const cached of props.minimapCachedUserMessages ?? []) {
            if (shouldHideMessageInChatList(cached)) continue;
            if (cached.seq != null && loadedBySeq.has(cached.seq)) continue;
            if (cached.localId && loadedByLocalId.has(cached.localId)) continue;
            merged.push(cached);
        }
        // Order oldest→newest to match the list (which sorts by createdAt, seq as tiebreaker).
        // createdAt must be primary: just-sent messages have no seq yet, so keying on seq would
        // sort them as seq 0 and shove them to the very top instead of the bottom.
        return merged
            .sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0))
            .map((message) => ({ message }));
    }, [props.minimapCachedUserMessages, loadedUserMessages]);
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

    // ---- Frozen scroll geometry (architecture note 3) ----
    // The canvas height is decoupled from the model total: it only changes at
    // renormalization points, never mid-gesture. canvasBottomOffsetPx is the
    // model coordinate at the canvas's bottom edge — 0 when normalized,
    // positive when content below the viewport grew while frozen (that growth
    // lives "below the canvas"), negative when it shrank. Both have ref
    // mirrors kept in sync AT THE SET SITE so event handlers running before
    // the re-render read fresh values.
    const [canvasHeightPx, setCanvasHeightPx] = useState(() => layout.totalHeightPx + (props.hasMore ? TOP_SLACK_PX : 0));
    const canvasHeightRef = useRef(canvasHeightPx);
    const [canvasBottomOffsetPx, setCanvasBottomOffsetPx] = useState(0);
    const canvasBottomOffsetRef = useRef(canvasBottomOffsetPx);
    const hasMoreRef = useRef(props.hasMore);
    hasMoreRef.current = props.hasMore;

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
    // A screen pushed on top keeps this one mounted under display:none
    // (react-navigation web). That destroys the scroller's CSS box:
    // scrollTop/clientHeight read 0 and writes are dropped, so hidden geometry
    // is treated as FROZEN — observers ignore it, and re-display re-asserts
    // the last position seen while visible. Raw is the hidden-time invariant:
    // content changes while covered fold into the canvas bottom offset.
    const lastVisibleRawRef = useRef(restored && !restored.atBottom ? restored.scrollDistancePx : 0);
    const scrollerWasHiddenRef = useRef(false);
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
    // See lastVisibleRawRef: a hidden (covered-screen) scroller has no box.
    const isScrollerHidden = () => {
        const scroller = scrollerElRef.current;
        return !scroller || scroller.clientHeight === 0;
    };
    const toModelDistance = (raw: number) => Math.max(0, raw - footerHeightRef.current + canvasBottomOffsetRef.current);
    // Content-space distance (raw + canvas bottom offset): stable across
    // renormalizations — what session restore stores and re-asserts.
    const toContentDistance = (raw: number) => raw + canvasBottomOffsetRef.current;
    const fromModelDistance = (model: number) => Math.max(0, model + footerHeightRef.current - canvasBottomOffsetRef.current);
    const setRawDistance = (raw: number) => {
        const scroller = scrollerElRef.current;
        // Hidden: the write would be dropped and the 0 read-back would corrupt
        // atBottom (a boxless scroller always reads "at bottom").
        if (!scroller || scroller.clientHeight === 0) return;
        scroller.scrollTop = raw === 0 ? 0 : -raw;
        lastSelfWriteRef.current = { rawPx: Math.abs(scroller.scrollTop), atMs: performance.now() };
        atBottomRef.current = Math.abs(scroller.scrollTop) <= SCROLL_THRESHOLD;
        lastVisibleRawRef.current = Math.abs(scroller.scrollTop);
    };

    const cancelScrollAnimation = () => {
        if (scrollAnimationFrameRef.current != null) {
            window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
        }
        isAnimatingScrollRef.current = false;
    };

    // ---- Renormalization of the frozen geometry ----

    const lastExternalScrollAtRef = useRef(-1e9);
    const lastSelfWriteRef = useRef<{ rawPx: number; atMs: number } | null>(null);
    const userInputTokenRef = useRef(0);
    const writeVerifierRef = useRef<{ expectedRawPx: number; untilMs: number; inputToken: number } | null>(null);
    const renormTimerRef = useRef<number | null>(null);
    const renormCountRef = useRef(0);
    const forcedRenormCountRef = useRef(0);
    const verifierRewriteCountRef = useRef(0);

    const isGestureActive = () =>
        performance.now() - Math.max(lastUserInputAtRef.current, lastExternalScrollAtRef.current) < GESTURE_QUIET_MS;
    const isRepositioning = () =>
        pendingJumpRef.current != null || pendingRestoreRef.current != null
        || isAnimatingScrollRef.current || pendingOpsRef.current != null;

    // One-shot guard over our own scrollTop writes: re-assert once if the
    // engine re-derives the offset asynchronously after a scrollHeight change.
    // Any newer user input disarms it, so it can never swallow scrolling.
    const checkWriteVerifier = () => {
        const verifier = writeVerifierRef.current;
        if (!verifier) return;
        if (performance.now() > verifier.untilMs || userInputTokenRef.current !== verifier.inputToken) {
            writeVerifierRef.current = null;
            return;
        }
        if (Math.abs(getRawDistance() - verifier.expectedRawPx) > WRITE_VERIFY_TOLERANCE_PX) {
            writeVerifierRef.current = null;
            verifierRewriteCountRef.current += 1;
            setRawDistance(verifier.expectedRawPx);
        }
    };
    const armWriteVerifier = (expectedRawPx: number) => {
        writeVerifierRef.current = {
            expectedRawPx,
            untilMs: performance.now() + WRITE_VERIFY_WINDOW_MS,
            inputToken: userInputTokenRef.current,
        };
        const step = () => {
            checkWriteVerifier();
            if (writeVerifierRef.current) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    };

    const desiredCanvasHeightPx = () => {
        const scroller = scrollerElRef.current;
        const layoutNow = layoutRef.current;
        const viewportTopModelPx = scroller
            ? toModelDistance(getRawDistance()) + scroller.clientHeight
            : layoutNow.totalHeightPx;
        return layoutNow.totalHeightPx + desiredTopSlackPx({
            hasMore: hasMoreRef.current,
            totalHeightPx: layoutNow.totalHeightPx,
            viewportTopModelPx,
            currentSlackPx: canvasHeightRef.current - layoutNow.totalHeightPx,
            maxSlackPx: TOP_SLACK_PX,
        });
    };
    // A pressed pointer inside the scroller (scrollbar drag, text selection)
    // owns the scroll position; idle renormalization waits for release so it
    // never fights a held scrollbar thumb.
    const isPointerDownRef = useRef(false);

    // A gesture can strand the viewport in the blank slack band above the
    // loaded content top (scrollbar flung to the edge).
    const isViewportInBand = (): boolean => {
        const scroller = scrollerElRef.current;
        if (!scroller) return false;
        const layoutNow = layoutRef.current;
        if (layoutNow.keys.length === 0) return false;
        return toModelDistance(getRawDistance()) + scroller.clientHeight
            > layoutNow.totalHeightPx + BAND_SNAP_THRESHOLD_PX;
    };
    const isRenormDirty = () =>
        canvasBottomOffsetRef.current !== 0
        || canvasHeightRef.current !== desiredCanvasHeightPx()
        || isViewportInBand();

    // Re-sync the canvas to the model and rewrite scrollTop equivalently.
    // Screen positions are invariant: a row sits (topFromBottom − offset)
    // above the canvas bottom and the viewport sits (raw − footer) above it,
    // so raw += offset while the offset returns to 0 keeps every visible
    // pixel in place. MUST NOT run from inside a React commit (flushSync).
    const performRenorm = () => {
        const scroller = scrollerElRef.current;
        // Hidden: the equivalent scrollTop rewrite would be dropped, silently
        // shifting the position by the folded offset. Just re-displayed: the
        // offset is not trustworthy until the re-show routine restores it.
        if (!scroller || scroller.clientHeight === 0 || scrollerWasHiddenRef.current || isRepositioning()) return;
        const cboPrev = canvasBottomOffsetRef.current;
        const nextCanvasHeight = desiredCanvasHeightPx();
        if (cboPrev === 0 && nextCanvasHeight === canvasHeightRef.current) return;
        const rawTarget = Math.max(0, getRawDistance() + cboPrev);
        renormCountRef.current += 1;
        canvasBottomOffsetRef.current = 0;
        canvasHeightRef.current = nextCanvasHeight;
        flushSync(() => {
            setCanvasBottomOffsetPx(0);
            setCanvasHeightPx(nextCanvasHeight);
        });
        // Reading scrollHeight forces layout on the committed styles, so the
        // write below lands against the new geometry — all before paint.
        const clamped = Math.min(rawTarget, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
        if (clamped !== getRawDistance()) setRawDistance(clamped);
        armWriteVerifier(clamped);
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
    };

    // Land exactly at the content bottom. performRenorm preserves the current
    // screen; this variant SEEKS the bottom — the explicit intent of
    // scroll-to-bottom — so an offset accumulated meanwhile (streaming during
    // the animation) can never leave the newest content clipped below the
    // canvas as a false bottom.
    const renormToBottom = () => {
        const scroller = scrollerElRef.current;
        if (!scroller || scroller.clientHeight === 0) return;
        const nextCanvasHeight = desiredCanvasHeightPx();
        if (canvasBottomOffsetRef.current !== 0 || nextCanvasHeight !== canvasHeightRef.current) {
            renormCountRef.current += 1;
            canvasBottomOffsetRef.current = 0;
            canvasHeightRef.current = nextCanvasHeight;
            flushSync(() => {
                setCanvasBottomOffsetPx(0);
                setCanvasHeightPx(nextCanvasHeight);
            });
        }
        setRawDistance(0);
        armWriteVerifier(0);
        updateViewportRef.current(0, scroller.clientHeight);
    };

    const ensureRenormLoop = () => {
        if (renormTimerRef.current != null) return;
        renormTimerRef.current = window.setTimeout(() => {
            renormTimerRef.current = null;
            // Hidden (or re-displayed with the restore not yet run): stop
            // polling; the re-show routine re-arms the loop.
            if (isScrollerHidden() || scrollerWasHiddenRef.current) return;
            if (!isRenormDirty()) return;
            if (!isGestureActive() && !isRepositioning() && !isPointerDownRef.current) {
                if (!maybeBandSnapToTopRef.current()) performRenorm();
            }
            if (isRenormDirty()) ensureRenormLoop();
        }, RENORM_TICK_MS);
    };

    // The frozen canvas cannot represent: (a) content below its bottom edge
    // once the viewport gets there (it is clipped), (b) content above its top
    // edge (prepends/corrections that outgrew the slack are clipped there, and
    // the canvas top is also a hard scroll wall), (c) slack blank above a
    // fully-loaded content top. Approaching any of those forces an immediate
    // renormalization, gesture or not — rare by construction. Runs on scroll
    // AND on raw input events: at the canvas-top wall the browser clamps
    // scrollTop, scroll events stop, and only input events can still unstick.
    const maybeForceRenorm = (raw: number) => {
        const scroller = scrollerElRef.current;
        if (!scroller || isRepositioning()) return;
        const cbo = canvasBottomOffsetRef.current;
        const layoutNow = layoutRef.current;
        const slackTop = canvasHeightRef.current + cbo - layoutNow.totalHeightPx;
        let force = false;
        if (cbo !== 0 && raw < footerHeightRef.current + 300) {
            force = true;
        } else if (raw - footerHeightRef.current + 2 * scroller.clientHeight > canvasHeightRef.current) {
            // Within a viewport of the canvas top: re-base while scroll events
            // still flow (a fresh renorm extends the canvas over any content
            // grown since the freeze). No-op when already normalized.
            force = true;
        } else if (!hasMoreRef.current && slackTop > 0
            && toModelDistance(raw) + scroller.clientHeight > layoutNow.totalHeightPx + 50) {
            force = true;
        }
        if (force) {
            forcedRenormCountRef.current += 1;
            performRenorm();
        }
    };

    // ---- Proxy scrollbar (see proxyScrollerStyle) ----

    const headerInsetRef = useRef(headerInsetPx);
    headerInsetRef.current = headerInsetPx;
    const proxyElRef = useRef<HTMLDivElement | null>(null);
    const proxyGhostElRef = useRef<HTMLDivElement | null>(null);
    const proxyGhostHeightRef = useRef(-1);
    // While the user holds the proxy (thumb drag), the proxy owns the
    // position and its ghost height is frozen — release resyncs.
    const proxyDraggingRef = useRef(false);
    const proxySelfWriteRef = useRef<{ topPx: number; atMs: number } | null>(null);

    // Real → proxy: mirror the content-space position onto the proxy's
    // native scrollbar. Proxy scrollTop 0 = content top, max = content bottom.
    const syncProxyFromReal = () => {
        const proxy = proxyElRef.current;
        const ghost = proxyGhostElRef.current;
        const scroller = scrollerElRef.current;
        if (!proxy || !ghost || !scroller || proxyDraggingRef.current) return;
        // Hidden (covered screen): both boxes read 0 — resynced on re-display.
        if (proxy.clientHeight === 0) return;
        const honestHeight = Math.max(0, Math.round(
            headerInsetRef.current + layoutRef.current.totalHeightPx + footerHeightRef.current,
        ));
        if (proxyGhostHeightRef.current !== honestHeight) {
            proxyGhostHeightRef.current = honestHeight;
            ghost.style.height = `${honestHeight}px`;
        }
        const maxTop = Math.max(0, honestHeight - proxy.clientHeight);
        const target = Math.max(0, Math.min(maxTop, maxTop - toContentDistance(getRawDistance())));
        if (Math.abs(proxy.scrollTop - target) > 1) {
            proxy.scrollTop = target;
            proxySelfWriteRef.current = { topPx: proxy.scrollTop, atMs: performance.now() };
        }
    };
    const syncProxyFromRealRef = useRef(syncProxyFromReal);
    syncProxyFromRealRef.current = syncProxyFromReal;

    // Proxy → real: the user drags the proxy thumb, clicks its track or
    // wheels over the strip. Positions route through content-space, so the
    // frozen bottom offset and canvas slack are handled by construction.
    const handleProxyScroll = () => {
        const proxy = proxyElRef.current;
        const scroller = scrollerElRef.current;
        if (!proxy || !scroller) return;
        // Hidden: a zeroed offset is box destruction, not a user drag. Just
        // re-displayed: the proxy hasn't been resynced yet — its offset is
        // engine noise until the re-show routine runs.
        if (proxy.clientHeight === 0 || scroller.clientHeight === 0) return;
        if (scrollerWasHiddenRef.current) return;
        const top = proxy.scrollTop;
        const selfWrite = proxySelfWriteRef.current;
        if (selfWrite != null
            && performance.now() - selfWrite.atMs < SELF_ECHO_WINDOW_MS
            && Math.abs(top - selfWrite.topPx) <= 1) {
            return;
        }
        lastUserInputAtRef.current = performance.now();
        userInputTokenRef.current += 1;
        pendingRestoreRef.current = null;
        cancelScrollAnimation();
        const maxTop = Math.max(0, proxyGhostHeightRef.current - proxy.clientHeight);
        const content = Math.max(0, maxTop - top);
        setRawDistance(Math.max(0, content - canvasBottomOffsetRef.current));
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        maybeLoadMoreRef.current();
    };
    const handleProxyScrollRef = useRef(handleProxyScroll);
    handleProxyScrollRef.current = handleProxyScroll;

    const detachProxyListenersRef = useRef<(() => void) | null>(null);
    const handleProxyEl = useCallback((el: HTMLDivElement | null) => {
        if (proxyElRef.current === el) return;
        detachProxyListenersRef.current?.();
        detachProxyListenersRef.current = null;
        proxyElRef.current = el;
        if (!el) return;
        const onScroll = () => handleProxyScrollRef.current();
        // Grabbing the proxy's scrollbar fires pointerdown with the proxy
        // itself as the target (scrollbars belong to the element).
        const onPointerDown = () => {
            proxyDraggingRef.current = true;
            isPointerDownRef.current = true;
            lastUserInputAtRef.current = performance.now();
            userInputTokenRef.current += 1;
            pendingRestoreRef.current = null;
            cancelScrollAnimation();
        };
        const onPointerUp = () => {
            if (!proxyDraggingRef.current) return;
            proxyDraggingRef.current = false;
            isPointerDownRef.current = false;
            syncProxyFromRealRef.current();
            if (isRenormDirty()) ensureRenormLoop();
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        el.addEventListener('pointerdown', onPointerDown, { passive: true });
        window.addEventListener('pointerup', onPointerUp, { passive: true });
        window.addEventListener('pointercancel', onPointerUp, { passive: true });
        detachProxyListenersRef.current = () => {
            el.removeEventListener('scroll', onScroll);
            el.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };
    }, []);
    const handleProxyGhostEl = useCallback((el: HTMLDivElement | null) => {
        proxyGhostElRef.current = el;
        if (el) {
            proxyGhostHeightRef.current = -1;
            syncProxyFromRealRef.current();
        }
    }, []);

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
    // the model, and fold any size change BELOW the viewport into the canvas
    // bottom offset (bottom-anchored coordinates shift only from below; the
    // offset replaces the scrollTop write of the pre-freeze design, so the
    // scroller's geometry stays untouched mid-gesture). At the bottom, stage a
    // pin back to 0 instead. Runs pre-paint in every path.
    const applyMeasuredHeights = (batch: Map<string, { element: HTMLElement; heightPx: number }>, useFlushSyncCommit: boolean): boolean => {
        const current = measuredHeightsRef.current;
        const layoutNow = layoutRef.current;
        let next = current;
        const rawNow = getRawDistance();
        const referenceModel = toModelDistance(rawNow);
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
        const pinToBottom = !restoreMode && atBottomRef.current && (!withinGrace || rawNow === 0);
        let nextCbo = canvasBottomOffsetRef.current;
        if (!restoreMode && !pinToBottom && deltaBelow !== 0) {
            nextCbo += deltaBelow;
        }

        measuredHeightsRef.current = next;
        preMeasureLayoutRef.current ??= layoutNow;
        const nextLayout = buildLayoutModel({ keys: layoutNow.keys, measuredHeightsByKey: next, estimateHeightPx: ROW_ESTIMATE_PX });
        const targetModel = restoreMode
            ? Math.max(0, (pendingRestoreRef.current ?? 0) - footerHeightRef.current)
            : pinToBottom
                ? Math.max(0, nextCbo - footerHeightRef.current)
                : Math.max(0, rawNow - footerHeightRef.current + nextCbo);
        const nextViewport = nextViewportState({
            current: viewportRef.current,
            layout: nextLayout,
            distanceFromBottomPx: targetModel,
            viewportHeightPx: viewportRef.current.viewportHeightPx,
            overscanCount: OVERSCAN_ROWS,
        });
        pendingOpsRef.current = { restore: restoreMode, pinToBottom, heights: next };
        canvasBottomOffsetRef.current = nextCbo;
        const commit = () => {
            setMeasuredHeights(next);
            setCanvasBottomOffsetPx(nextCbo);
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
        // A hidden scroller reads 0/0 — teleporting the window to the bottom
        // on those coordinates would unmount the rows the user was reading.
        if (viewportHeightPx <= 0) return;
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

    // Re-assert a pending session restore (a content-space distance).
    // Consumed once it lands within tolerance, or once it's clear it can never
    // land (content exhausted).
    const reassertPendingRestore = () => {
        const target = pendingRestoreRef.current;
        if (target == null) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        // Hidden: keep the restore armed; re-display re-asserts it.
        if (scroller.clientHeight === 0) return;
        setRawDistance(Math.max(0, target - canvasBottomOffsetRef.current));
        const actual = toContentDistance(Math.abs(scroller.scrollTop));
        if (Math.abs(actual - target) <= RESTORE_TOLERANCE_PX) {
            pendingRestoreRef.current = null;
        } else if (!props.hasMore
            && scroller.scrollHeight - scroller.clientHeight + canvasBottomOffsetRef.current < target - RESTORE_TOLERANCE_PX) {
            // All content is loaded and it simply isn't tall enough anymore.
            pendingRestoreRef.current = null;
        }
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
    };
    const reassertPendingRestoreRef = useRef(reassertPendingRestore);
    reassertPendingRestoreRef.current = reassertPendingRestore;

    // First sight of the scroller after a covered period. Runs from WHICHEVER
    // entry point the engine reaches first — a scroll/scrollend/wheel/key
    // event or the ResizeObserver callback (scroll events are delivered
    // before RO callbacks within a frame, so the RO alone would let a
    // spontaneous post-re-display event be misread as user scrolling and
    // clobber the saved position). Chromium restores the pre-hide offset with
    // the box; engines that don't leave it at 0 — either way, re-assert the
    // last position seen while visible (raw is the hidden-time invariant:
    // content changes while covered folded into the canvas bottom offset).
    const maybeHandleReshow = (): boolean => {
        if (!scrollerWasHiddenRef.current) return false;
        const scroller = scrollerElRef.current;
        if (!scroller || scroller.clientHeight === 0) return false;
        scrollerWasHiddenRef.current = false;
        if (pendingRestoreRef.current == null && !atBottomRef.current) {
            pendingRestoreRef.current = lastVisibleRawRef.current + canvasBottomOffsetRef.current;
        }
        reassertPendingRestoreRef.current();
        if (pendingRestoreRef.current == null && !atBottomRef.current) {
            // Guard the landing against an asynchronous engine restoration of
            // the stale pre-hide offset.
            armWriteVerifier(getRawDistance());
        }
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        syncProxyFromRealRef.current();
        if (isRenormDirty()) ensureRenormLoop();
        return true;
    };
    const maybeHandleReshowRef = useRef(maybeHandleReshow);
    maybeHandleReshowRef.current = maybeHandleReshow;

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
        // Covered screen (display:none): a zeroed offset is box destruction,
        // not scrolling — recording it would corrupt atBottom and the session
        // restore cache.
        if (scroller.clientHeight === 0) {
            scrollerWasHiddenRef.current = true;
            return;
        }
        // First visible event after a covered period: restore, don't record.
        if (maybeHandleReshowRef.current()) return;
        checkWriteVerifier();
        const raw = Math.abs(scroller.scrollTop);
        lastVisibleRawRef.current = raw;
        // Echoes of our own writes must not count as user scrolling, or every
        // renormalization would extend the frozen state it just resolved.
        const selfWrite = lastSelfWriteRef.current;
        const isSelfEcho = selfWrite != null
            && performance.now() - selfWrite.atMs < SELF_ECHO_WINDOW_MS
            && Math.abs(raw - selfWrite.rawPx) <= 1;
        if (!isSelfEcho) lastExternalScrollAtRef.current = performance.now();
        const atBottom = raw <= SCROLL_THRESHOLD;
        atBottomRef.current = atBottom;
        visibilityControllerRef.current?.update(!atBottom);
        rememberSessionRestoreState(props.sessionId, {
            scrollDistancePx: toContentDistance(raw),
            atBottom,
            // Heights/window are captured on unmount; scroll events only keep
            // the cheap fields fresh.
            heightsByKey: sessionRestoreStates.get(props.sessionId)?.heightsByKey ?? {},
            renderedWindow: sessionRestoreStates.get(props.sessionId)?.renderedWindow ?? null,
        });
        maybeForceRenorm(raw);
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        maybeLoadMoreRef.current();
        syncProxyFromRealRef.current();
        if (isRenormDirty()) ensureRenormLoop();
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
                userInputTokenRef.current += 1;
                // The user takes over: any pending restore or animation yields.
                pendingRestoreRef.current = null;
                cancelScrollAnimation();
            };
            // Wheel input keeps arriving even when scrollTop is clamped at the
            // frozen canvas's top wall (where scroll events go silent) — it
            // must be able to unstick the geometry and keep paging.
            const onWheel = () => {
                maybeHandleReshowRef.current();
                onUserInput();
                maybeForceRenorm(getRawDistance());
                maybeLoadMoreRef.current();
            };
            // Gesture finished (momentum included): renormalize right away if
            // input is quiet too, otherwise let the timer loop catch up.
            const onScrollEnd = () => {
                // Covered / just re-displayed: the offset is not trustworthy
                // yet — the re-show routine (scroll/RO path) restores first.
                if (isScrollerHidden() || scrollerWasHiddenRef.current) return;
                if (performance.now() - lastUserInputAtRef.current >= 80 && !isRepositioning() && !isPointerDownRef.current) {
                    if (!maybeBandSnapToTopRef.current()) performRenorm();
                }
                if (isRenormDirty()) ensureRenormLoop();
            };
            const onPointerDown = () => {
                isPointerDownRef.current = true;
                onUserInput();
            };
            const onPointerUp = () => {
                if (!isPointerDownRef.current) return;
                isPointerDownRef.current = false;
                if (isRenormDirty()) ensureRenormLoop();
            };
            el.addEventListener('scroll', onScroll, { passive: true });
            el.addEventListener('scrollend', onScrollEnd, { passive: true });
            el.addEventListener('wheel', onWheel, { passive: true });
            el.addEventListener('touchstart', onUserInput, { passive: true });
            el.addEventListener('pointerdown', onPointerDown, { passive: true });
            // Release can land outside the scroller (thumb dragged past the
            // edge) — track it at the window.
            window.addEventListener('pointerup', onPointerUp, { passive: true });
            window.addEventListener('pointercancel', onPointerUp, { passive: true });
            detachScrollerListenersRef.current = () => {
                el.removeEventListener('scroll', onScroll);
                el.removeEventListener('scrollend', onScrollEnd);
                el.removeEventListener('wheel', onWheel);
                el.removeEventListener('touchstart', onUserInput);
                el.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
            };
            if (typeof ResizeObserver !== 'undefined') {
                const observer = new ResizeObserver(() => {
                    // Covered by another screen (display:none): geometry reads
                    // 0/0 and writes are dropped — freeze until re-display.
                    if (el.clientHeight === 0) {
                        scrollerWasHiddenRef.current = true;
                        return;
                    }
                    if (maybeHandleReshowRef.current()) return;
                    updateViewportRef.current(Math.abs(el.scrollTop), el.clientHeight);
                    reassertPendingRestoreRef.current();
                    syncProxyFromRealRef.current();
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
            // Covered screen: the whole subtree reads 0 — box destruction,
            // not a real footer resize. Keeping the pre-hide height means the
            // re-display resize computes its delta against it (usually 0).
            const scrollerNow = scrollerElRef.current;
            if (!scrollerNow || scrollerNow.clientHeight === 0) return;
            const height = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
            const prev = footerHeightRef.current;
            footerHeightRef.current = height;
            const delta = height - prev;
            syncProxyFromRealRef.current();
            if (delta === 0 || isAnimatingScrollRef.current) return;
            const scroller = scrollerElRef.current;
            if (!scroller || atBottomRef.current || pendingRestoreRef.current != null) return;
            // The footer lives outside the canvas, so its resize is a real
            // scrollHeight change the freeze cannot absorb — write, then guard
            // the write against an asynchronous engine re-derivation.
            setRawDistance(Math.abs(scroller.scrollTop) + delta);
            armWriteVerifier(Math.abs(scroller.scrollTop));
        });
        observer.observe(el);
        footerResizeObserverRef.current = observer;
    }, []);

    // ---- On-demand history paging (FlatList-era policy) ----
    // Load an older page only when the viewport nears the visual top of the
    // loaded content (plus a fill pass so short first pages keep loading until
    // the threshold is out of reach). Prepends land above the viewport —
    // bottom-anchored coordinates don't move, so paging is invisible.
    // Guards against a jump-triggered load racing with the scroll-driven one.
    const isJumpingRef = useRef(false);
    const maybeLoadMore = () => {
        const scroller = scrollerElRef.current;
        if (!scroller || isJumpingRef.current || isLoadingMoreRef.current) return;
        if (!props.hasMore || !props.onLoadMore) return;
        // Model-space distance to the top of loaded content (scrollHeight
        // would count the canvas top slack as content).
        const distanceToTop = layoutRef.current.totalHeightPx
            - (toModelDistance(Math.abs(scroller.scrollTop)) + scroller.clientHeight);
        if (distanceToTop > LOAD_MORE_DISTANCE_PX) return;
        isLoadingMoreRef.current = true;
        Promise.resolve(props.onLoadMore())
            .catch(() => { /* a failed page must not end the polling below */ })
            .finally(() => {
                isLoadingMoreRef.current = false;
                // Without this, a load that made no (or not-yet-visible)
                // progress strands a motionless viewport in the blank band:
                // no scroll or entry event is left to re-fire the trigger.
                // The retry re-checks every guard, so it self-terminates once
                // out of range or history is exhausted.
                window.setTimeout(() => maybeLoadMoreRef.current(), LOAD_MORE_RETRY_MS);
            });
    };
    const maybeLoadMoreRef = useRef(maybeLoadMore);
    maybeLoadMoreRef.current = maybeLoadMore;
    React.useEffect(() => {
        maybeLoadMoreRef.current();
    }, [visibleMessages]);

    // ---- Jump to a minimap prompt ----

    // Post-jump feedback: shake the landed row. transform doesn't change the
    // row's box, so the ResizeObserver/compensation pipeline never notices it
    // (the scroller clips the ±4px horizontal excursion via overflow-x).
    const shakeAnimationRef = useRef<Animation | null>(null);
    const shakeRow = (key: string) => {
        const el = rowElsByKeyRef.current.get(key);
        if (!el || typeof el.animate !== 'function') return;
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        shakeAnimationRef.current?.cancel();
        shakeAnimationRef.current = el.animate(SHAKE_KEYFRAMES, {
            duration: SHAKE_DURATION_MS,
            delay: SHAKE_DELAY_MS,
            easing: 'ease-in-out',
        });
    };

    const jumpNonceRef = useRef(0);
    // Start a jump for a target that is in memory: teleport the window to the
    // target and position it instantly from the model — the same single path
    // whether or not the row happens to be mounted. No animation, ever.
    const startJump = (target: UserTextMessage): boolean => {
        const message = visibleMessagesRef.current.find((m) => messageMatchesTarget(m, target));
        if (!message) return false;
        cancelScrollAnimation();
        pendingRestoreRef.current = null;
        const jump: PendingJump = { key: message.id, nonce: ++jumpNonceRef.current, align: 'center', silent: false };
        pendingJumpRef.current = jump;
        setPendingJump(jump);
        return true;
    };
    const startJumpRef = useRef(startJump);
    startJumpRef.current = startJump;

    // Idle band snap: a gesture stranded the viewport in the blank band above
    // the loaded content top. Land it on the OLDEST LOADED ROW via the jump
    // machinery — the jump landing re-measures the mounted rows before
    // positioning, so estimate inflation at the top cannot drag the landing
    // away (a px-target write sinks thousands of px below the top while the
    // freshly mounted estimates correct themselves).
    const maybeBandSnapToTop = (): boolean => {
        if (isRepositioning() || !isViewportInBand()) return false;
        const oldestKey = layoutRef.current.keys[0];
        if (oldestKey == null) return false;
        cancelScrollAnimation();
        const jump: PendingJump = { key: oldestKey, nonce: ++jumpNonceRef.current, align: 'top', silent: true };
        pendingJumpRef.current = jump;
        setPendingJump(jump);
        return true;
    };
    const maybeBandSnapToTopRef = useRef(maybeBandSnapToTop);
    maybeBandSnapToTopRef.current = maybeBandSnapToTop;

    // The target of the in-flight jump. A second minimap click updates this so the running paging
    // loop retargets instead of the click being silently dropped.
    const activeJumpTargetRef = useRef<UserTextMessage | null>(null);
    const handleJumpToMessage = useCallback(async (target: UserTextMessage) => {
        activeJumpTargetRef.current = target;
        // A paging jump is already running — it will pick up the new target above. Keep the hint.
        if (isJumpingRef.current) return;
        // Already loaded → jump straight away.
        if (startJumpRef.current(target)) return;
        isJumpingRef.current = true;
        setIsLocating(true);
        try {
            // Page older messages until the (possibly retargeted) message enters the list, there's
            // nothing older left, or a load can't make progress.
            const MAX_PAGES = 200;
            for (let i = 0; i < MAX_PAGES; i++) {
                const current = activeJumpTargetRef.current;
                if (!current) break;
                const state = storage.getState().sessionMessages[sessionIdRef.current];
                if (!state || !state.hasMore) break;
                if (state.messages.some((m) => messageMatchesTarget(m, current))) break;
                const beforeOldestSeq = state.oldestSeq;
                await props.onLoadMore?.();
                // Let the store subscription flush into visibleMessagesRef before re-checking.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                const loaded = storage.getState().sessionMessages[sessionIdRef.current];
                if (!loaded) break;
                const retargeted = activeJumpTargetRef.current ?? current;
                if (loaded.messages.some((m) => messageMatchesTarget(m, retargeted))) break;
                // Safety: if we've paged at/past the target's seq without finding it, stop.
                if (retargeted.seq != null && loaded.oldestSeq != null && loaded.oldestSeq <= retargeted.seq) break;
                // No progress (e.g. encryption briefly unavailable, or oldestSeq null) — stop instead
                // of spinning through all MAX_PAGES iterations.
                if (loaded.oldestSeq === beforeOldestSeq) break;
            }
            const finalTarget = activeJumpTargetRef.current;
            if (finalTarget) {
                // The store commit must reach visibleMessagesRef (a React render) before the jump
                // can resolve the row — retry on a bounded schedule instead of a single tick.
                const MAX_ATTEMPTS = 20; // ~1s at 50ms
                for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    if (startJumpRef.current(finalTarget)) break;
                    await new Promise<void>((resolve) => setTimeout(resolve, 50));
                }
            }
        } finally {
            isJumpingRef.current = false;
            setIsLocating(false);
        }
    }, [props.onLoadMore]);

    // ---- Render-phase window overrides ----
    // A pending jump mounts its target in the SAME commit that requested it;
    // an entry-set change remaps the window to follow its anchor key (indices
    // shift on prepends).
    let renderedRange: RenderRange = viewport.renderedRange;
    if (pendingJump != null) {
        const jumpDistance = pendingJump.align === 'top'
            ? distanceToAlignEntryTop({ layout, key: pendingJump.key, viewportHeightPx: viewport.viewportHeightPx, topInsetPx: BAND_PEEK_PX })
            : distanceToCenterEntry({ layout, key: pendingJump.key, viewportHeightPx: viewport.viewportHeightPx });
        if (jumpDistance != null) {
            renderedRange = computeVisibleRange({
                layout,
                distanceFromBottomPx: jumpDistance,
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
        syncProxyFromRealRef.current();
        if (isRenormDirty()) ensureRenormLoop();
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
        const prevTop = entryTopFromBottom(previous, anchorKey);
        const nextTop = entryTopFromBottom(next, anchorKey);
        if (prevTop == null || nextTop == null || nextTop === prevTop) return;
        // The anchor's distance-from-bottom moved (appends/removals below the
        // viewport; prepends are delta 0 by construction). Fold the shift into
        // the canvas bottom offset — the window margin re-renders pre-paint
        // and the scroller's geometry stays frozen.
        const nextCbo = canvasBottomOffsetRef.current + (nextTop - prevTop);
        canvasBottomOffsetRef.current = nextCbo;
        setCanvasBottomOffsetPx(nextCbo);
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        ensureRenormLoop();
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

    // 3. Drain staged measurement ops right after the commit, before paint:
    // re-assert a pending restore or pin back to the bottom. Everything else
    // was absorbed into the canvas bottom offset — no scroll write needed.
    React.useLayoutEffect(() => {
        const ops = pendingOpsRef.current;
        if (!ops || ops.heights !== measuredHeights) return;
        pendingOpsRef.current = null;
        if (ops.restore) {
            reassertPendingRestoreRef.current();
        } else if (ops.pinToBottom && !isAnimatingScrollRef.current) {
            setRawDistance(0);
        }
        if (isRenormDirty()) ensureRenormLoop();
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
        const modelDistance = jump.align === 'top'
            ? distanceToAlignEntryTop({
                layout,
                key: jump.key,
                viewportHeightPx: scroller.clientHeight,
                topInsetPx: BAND_PEEK_PX,
            })
            : distanceToCenterEntry({
                layout,
                key: jump.key,
                viewportHeightPx: scroller.clientHeight,
            });
        const clearJump = () => queueMicrotask(() => {
            if (pendingJumpRef.current === jump) pendingJumpRef.current = null;
            setPendingJump((current) => (current === jump ? null : current));
        });
        if (modelDistance == null) {
            clearJump();
            return;
        }
        const raw = modelDistance === 0 ? 0 : fromModelDistance(modelDistance);
        setRawDistance(raw);
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        if (!jump.silent) {
            shakeRow(jump.key);
            if (__DEV__) {
                console.log('[ChatList] jump landed', { key: jump.key, raw: Math.round(raw) });
            }
        }
        clearJump();
        if (isRenormDirty()) ensureRenormLoop();
    });

    // ---- Plumbing effects ----

    React.useEffect(() => {
        props.onRegisterMinimapJump?.(handleJumpToMessage);
        return () => props.onRegisterMinimapJump?.(null);
    }, [props.onRegisterMinimapJump, handleJumpToMessage]);

    // Keyboard scrolling (arrows / paging keys) drives the same native scroll
    // animation as the wheel, so it must count as user input for the geometry
    // freeze, restore-yield and grace logic. Typing in the composer is not
    // scrolling — editable targets are skipped.
    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!SCROLL_KEYS.has(event.key)) return;
            // Covered by another screen: those keys scroll that screen.
            if (isScrollerHidden()) return;
            maybeHandleReshowRef.current();
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            lastUserInputAtRef.current = performance.now();
            userInputTokenRef.current += 1;
            pendingRestoreRef.current = null;
            cancelScrollAnimation();
            // Same unstick duty as the wheel listener: at the canvas-top wall
            // scroll events go silent, key events must keep things moving.
            maybeForceRenorm(getRawDistance());
            maybeLoadMoreRef.current();
        };
        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Dev-only diagnostics: window.__chatListFreeze() dumps the frozen-
    // geometry state and counters.
    React.useEffect(() => {
        if (!__DEV__) return;
        const host = window as unknown as Record<string, unknown>;
        host.__chatListFreeze = () => ({
            totalHeightPx: layoutRef.current.totalHeightPx,
            canvasHeightPx: canvasHeightRef.current,
            canvasBottomOffsetPx: canvasBottomOffsetRef.current,
            renorms: renormCountRef.current,
            forcedRenorms: forcedRenormCountRef.current,
            verifierRewrites: verifierRewriteCountRef.current,
        });
        return () => { delete host.__chatListFreeze; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            // Unmounting while covered (display:none) reads a zeroed offset —
            // fall back to the last position seen while visible.
            scrollDistancePx: scroller && scroller.clientHeight > 0
                ? toContentDistance(Math.abs(scroller.scrollTop))
                : lastVisibleRawRef.current + canvasBottomOffsetRef.current,
            atBottom: atBottomRef.current,
            heightsByKey,
            renderedWindow: anchorKey
                ? { anchorKey, count: vp.renderedRange.endIndex - vp.renderedRange.startIndex }
                : null,
        });
        if (renormTimerRef.current != null) {
            window.clearTimeout(renormTimerRef.current);
            renormTimerRef.current = null;
        }
        writeVerifierRef.current = null;
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
        // Fold any frozen bottom offset back in so the animation start (and
        // its raw-0 destination) are measured against the true content bottom.
        performRenorm();
        const start = Math.abs(scroller.scrollTop);
        if (start <= RESTORE_TOLERANCE_PX
            || start > SCROLL_TO_BOTTOM_ANIMATE_MAX_VIEWPORTS * scroller.clientHeight) {
            // Already there (covers the stuck case: raw ~0 with the content
            // bottom below the canvas) — or too far for the animation to read
            // as motion: land instantly. Distance 0 is estimate-free in
            // bottom-anchored coordinates, so the teleport is always exact.
            renormToBottom();
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
                atBottomRef.current = true;
                cancelScrollAnimation();
                // Offsets accumulate DURING the animation when content below
                // the viewport streams in; raw 0 alone would land on a false
                // bottom with the newest content clipped below the canvas.
                renormToBottom();
            }
        };
        scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
    }, []);

    // ---- Render ----

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

    // Window position inside the canvas: the model's top offset shifted by the
    // slack above the content (canvas taller than the content) and the frozen
    // bottom offset. Both are 0 in normalized idle state, where this reduces
    // to the plain model top offset.
    const slackTopPx = canvasHeightPx + canvasBottomOffsetPx - layout.totalHeightPx;
    const windowMarginTopPx = (layout.topOffsetsPx[renderedRange.startIndex] ?? layout.totalHeightPx) + slackTopPx;

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
                <div ref={handleScrollerEl} className={SCROLLBAR_HIDE_CLASS} style={scrollerStyle}>
                    <div style={contentColumnStyle}>
                        <div style={{ height: headerInsetPx, flexShrink: 0 }} />
                        {/* The canvas: explicit height (model total + top slack),
                            frozen while the user scrolls. overflow:clip keeps any
                            transient window overflow out of scrollHeight; the
                            paging spinner is position:absolute just above the
                            content top so its mount/unmount can't resize the
                            scroller either. */}
                        <div style={{ height: canvasHeightPx, position: 'relative', overflow: 'clip', flexShrink: 0 }}>
                            {props.hasMore && (
                                <div style={{ position: 'absolute', top: Math.max(0, slackTopPx - 64), left: 0, right: 0 }}>
                                    <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    </View>
                                </div>
                            )}
                            <div style={{ ...windowColumnStyle, marginTop: windowMarginTopPx }}>
                                {rows}
                            </div>
                        </div>
                        <div ref={handleFooterEl} style={{ flexShrink: 0 }}>
                            <ListFooter sessionId={props.sessionId} />
                        </div>
                    </div>
                </div>
            )}

            {/* Proxy scrollbar: shows the honest loaded height (no canvas
                slack); the real scroller's native bar is hidden. */}
            {visibleMessages.length > 0 && (
                <div ref={handleProxyEl} style={{ ...proxyScrollerStyle, width: proxyStripWidthPx() }}>
                    <div ref={handleProxyGhostEl} style={{ width: 1 }} />
                </div>
            )}

            {/* Bottom-centered hint shown while a minimap jump is paging in older messages */}
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
