import * as React from 'react';
import { useSession, useSessionMessages, useProfile, useSetting, storage } from "@/sync/storage";
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
import { AskUserQuestionMessage, isAskUserQuestionToolCall, isExitPlanModeToolCall, isPreviewHtmlToolCall, Message, MinimapMessage, PlanProposalMessage, PreviewHtmlMessage, toAskUserQuestionMessage, toPlanProposalMessage, toPreviewHtmlMessage, UserTextMessage } from '@/sync/typesMessage';
import { currentLandmark, isMinimapLandmarkRow, railLandmarkRows, shouldHideMessageInChatList, shouldHideMessageInMinimap, type LandmarkRow } from './chatListVisibility';
import { foldedLineKeepsRow } from './turnFold';
import { turnHeaderProps, useTurnAnalysis } from './messageTurnTiming';
import { newestRowSnapshot } from './rowSnapshot';
import { toolTitle } from './tools/toolTitle';
import { useTurnFolding } from '@/hooks/useTurnFolding';
import { useFoldAnimation } from '@/hooks/useFoldAnimation';
import { AWAITING_RESPONSE_MAX_MS } from '@/utils/sessionUtils';
import { layout as appLayout } from './layout';
import { createScrollButtonVisibilityController } from './scrollButtonVisibilityController';
import { createProxyScrollIntent } from './proxyScrollIntent';
import { createScrollDistanceController } from './scrollDistanceController';
import { t } from '@/text';
import {
    buildLayoutModel,
    computeVisibleRange,
    distanceToCenterEntry,
    entryTopFromBottom,
    minimumCanvasHeightPx,
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
// Folding a turn's process lives here and only here. Keeping the line the reader tapped where they
// tapped it needs the layout model below: the rows under the line change the height of the content
// between it and the answer, and only the model can say by how much before the frame paints. The
// native list has no such model, so the fold would take the line out from under their finger. It
// waits for a list that can.
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
// 3. The canvas IS the model: its height is the content's own (plus the fill a
//    conversation shorter than the viewport needs), so the scroll range always
//    reaches every row and no distance ever has to live outside it. Nothing
//    about the geometry is frozen, and nothing is carried: every correction is
//    a scroll write made against a number we own — the distance the controller
//    was last TOLD to be at, never a re-derivation from what the engine
//    reported back (see scrollDistanceController.ts). That is what keeps a fold
//    from creeping: the quantization an engine applies to scrollTop is spent
//    once instead of being re-imported as the next correction's starting point.
//    The content column is bottom-packed inside a column-reverse scroller with
//    `overflow-anchor: none`, so a scrollHeight change never moves the visible
//    content on its own: growth above the viewport (a page prepend, a
//    correction of an estimated row entering from the top) is invisible by
//    construction, and growth below it is absorbed by exactly one rule in
//    `applyMeasuredHeights` — the heights that changed at or below the row the
//    reader is looking at move the viewport by their sum, and nothing else
//    moves. `overflow: clip` on the canvas keeps transient window overflow out
//    of scrollHeight.
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

// Does a loaded list message correspond to the given minimap target (whose id may come from the
// throwaway reducer and therefore not match the store's id)?
function messageMatchesTarget(message: Message, target: MinimapMessage): boolean {
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

// A loaded user message paired with its index in the newest-first `listedMessages`.
type LoadedUserMessage = { message: UserTextMessage; index: number };

export const ChatList = React.memo((props: { session: Session; onFillInput?: (text: string, allOptions?: string[]) => void; onLoadMore?: () => void; onForkMessage?: (request: ForkMessageRequest) => void; forkingMessageId?: string | null; minimapCachedUserMessages?: MinimapMessage[]; onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void; onActiveMessageIdChange?: (id: string | null) => void; onRegisterMinimapJump?: (jump: ((message: MinimapMessage) => void) | null) => void }) => {
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
            taskCompleted={props.session.agentState?.taskCompleted}
            awaitingResponseSince={props.session.awaitingResponseSince}
            forkingMessageId={props.forkingMessageId}
            minimapCachedUserMessages={props.minimapCachedUserMessages}
            onMinimapItemsChange={props.onMinimapItemsChange}
            onActiveMessageIdChange={props.onActiveMessageIdChange}
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
// How far past the viewport's own top edge an anchor may reach before its top counts as scrolled
// off. A pixel of slack so that a row sitting exactly at the edge is still "on screen".
const ANCHOR_TOP_SLACK_PX = 1;
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
// Scrolling counts as in-flight until both input and scroll events have been
// quiet this long (the proxy scrollbar's intent tracker).
const GESTURE_QUIET_MS = 160;
// A proxy scroll event this close (time and px) to our own last write is the
// echo of that write, not the user dragging the proxy's scrollbar.
const SELF_ECHO_WINDOW_MS = 120;
// Re-check the load-more trigger this often after a load completes — a load
// with no (or not-yet-visible) progress otherwise strands a motionless
// viewport with nothing left to re-fire the trigger.
const LOAD_MORE_RETRY_MS = 300;
/** How close a jump's scroll write has to land to count as taken. */
const JUMP_LAND_TOLERANCE_PX = 1;
/** How many commits a jump may be repositioned on before it gives up. */
const MAX_JUMP_ATTEMPTS = 12;
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
    // Flat so a list re-render doesn't change this row's props unless its own
    // turn did (see turnHeaderProps).
    isTurnStart: boolean,
    turnStartedAt: number | undefined,
    turnCompletedAt: number | null | undefined,
    // Fold state, on the row that opens a foldable turn only (see turnFold.ts).
    foldFolded: boolean | undefined,
    foldKeepsRow: boolean,
    foldDivides: boolean,
    foldSteps: number | undefined,
    foldSnapshot: string | undefined,
    onToggleFold: ((headerId: string) => void) | undefined,
    constrainedHeightPx: number | undefined,
    // Set only while this row's height belongs to a fold animation: the animation writes the height
    // and the clip onto the outer wrapper (never onto the inner element the observer measures), so
    // the row stays a row to the measurement pipeline however tall it is being drawn.
    outerRefCallback: ((el: HTMLDivElement | null) => void) | undefined,
    // The same, for the row that opens the fold: there the animated element is the row's content
    // inside `MessageView`, because the folded line above it must not move.
    foldBodyRef: ((el: HTMLElement | null) => void) | undefined,
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
        <div ref={props.outerRefCallback} style={outerStyle}>
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
                    turnStartedAt={props.turnStartedAt}
                    turnCompletedAt={props.turnCompletedAt}
                    isTurnStart={props.isTurnStart}
                    foldFolded={props.foldFolded}
                    foldKeepsRow={props.foldKeepsRow}
                    foldDivides={props.foldDivides}
                    foldSteps={props.foldSteps}
                    foldSnapshot={props.foldSnapshot}
                    onToggleFold={props.onToggleFold}
                    foldBodyRef={props.foldBodyRef}
                />
            </div>
        </div>
    );
});

type PendingJump = {
    key: string;
    nonce: number;
    /** Commits this jump has been positioned on without the write taking. */
    attempts?: number;
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
    // The raw distance this commit's heights were absorbed into. The next batch
    // adds to this rather than reading a position back out of the document.
    scrollDistancePx?: number;
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
    /** `session.agentState.taskCompleted` — the CLI's stamp for the newest finished task. */
    taskCompleted?: number | null,
    /** `session.awaitingResponseSince` — set the moment a message is sent. */
    awaitingResponseSince?: number | null,
    forkingMessageId?: string | null,
    minimapCachedUserMessages?: MinimapMessage[],
    onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void,
    /** The landmark the rail should mark as the reader's — see `currentLandmark`. */
    onActiveMessageIdChange?: (id: string | null) => void,
    onRegisterMinimapJump?: (jump: ((message: MinimapMessage) => void) | null) => void,
}) => {
    const { theme } = useUnistyles();
    const showThinkingMessages = useSetting('showThinkingMessages');
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

    const foldTurnProcess = useSetting('foldTurnProcess');
    // For the snapshot a running turn's folded line carries.
    const messageById = React.useMemo(() => {
        const map = new Map<string, Message>();
        for (const message of props.messages) map.set(message.id, message);
        return map;
    }, [props.messages]);
    const listedMessages = React.useMemo(
        () => props.messages.filter((message) => !shouldHideMessageInChatList(message, showThinkingMessages)),
        [props.messages, showThinkingMessages]
    );

    // Which rows carry the action bar, which rows carry their turn's header, and
    // how long each turn took. See messageTurnTiming.ts for the rules.
    //
    // In flight means the CLI says it is thinking *or* the optimistic marker set
    // when a message is sent is still standing: the marker is written in the same
    // store update that lands the message, so a reply's header arrives with the
    // message instead of a CLI heartbeat later.
    const turnInFlight = !!props.thinking
        || (props.awaitingResponseSince != null
            && Date.now() - props.awaitingResponseSince < AWAITING_RESPONSE_MAX_MS);
    const turns = useTurnAnalysis({
        visibleMessages: listedMessages,
        turnInFlight,
        taskCompletedAt: props.taskCompleted,
    });

    // Which turns are showing their process and which are showing one line.
    //
    // A folded row stays in the key set and takes no height there (see `collapsedKeys`), rather than
    // leaving the set: this list sizes rows from a model that outlives a render, so a row that left
    // would have to be measured again on its way back and everything below it would move while it
    // happened. A row that is still there at zero height keeps its measurement, and can grow back
    // from it — which is also what an expand animation needs to know its endpoint.
    const folding = useTurnFolding({ foldById: turns.foldById, enabled: foldTurnProcess });
    // The height animation a fold plays, and the rows it is playing on. Owns no layout of its own:
    // it writes heights onto the elements it is given and reads them back, nothing else.
    const foldAnim = useFoldAnimation();
    // Read by the measurement pipeline, which runs from observer callbacks rather than a render.
    const hiddenIdsRef = useRef(folding.hiddenIds);
    hiddenIdsRef.current = folding.hiddenIds;
    // What a tap on a fold line needs to know about that line, keyed by the row the line sits on:
    // which rows the fold takes, and whether the line's own row is one of them. Filled by the rows
    // loop below, so that `handleToggleFold` can stay stable for every row's memo.
    const foldTapRef = useRef<Map<string, { hiddenIds: readonly string[]; keepsRow: boolean; folded: boolean }>>(
        new Map(),
    );
    const listedMessagesRef = useRef(listedMessages);
    listedMessagesRef.current = listedMessages;

    // Compute which user-text messages should show sender name labels.
    // In the newest-first array (index 0 = newest), show name when the next item
    // in the array (= older message at higher index) is from a different sender
    // or is not a user-text message, so only the first in a consecutive group shows it.
    const senderVisibility = React.useMemo(() => {
        if (!props.isSharedSession) return null;
        const map = new Map<string, boolean>();
        for (let i = 0; i < listedMessages.length; i++) {
            const msg = listedMessages[i];
            if (msg.kind !== 'user-text') continue;
            const nextMsg = listedMessages[i + 1];
            const nextSentBy = nextMsg?.kind === 'user-text' ? nextMsg.sentBy : null;
            map.set(msg.id, msg.sentBy !== nextSentBy);
        }
        return map;
    }, [listedMessages, props.isSharedSession]);

    // For each agent message, the user prompt that FOLLOWS it in time (nearest
    // lower index in the newest-first array) — the fork truncation target for
    // AI-reply forks. Single pass instead of a per-row backward scan.
    const forkTargetsById = React.useMemo(() => {
        const map = new Map<string, UserTextMessage | null>();
        let nextUserMessage: UserTextMessage | null = null;
        for (let i = 0; i < listedMessages.length; i++) {
            const msg = listedMessages[i];
            if (msg.kind === 'user-text') {
                nextUserMessage = msg;
            } else if (msg.kind === 'agent-text') {
                map.set(msg.id, nextUserMessage);
            }
        }
        return map;
    }, [listedMessages]);

    // Loaded user messages in ascending (oldest→newest) order, carrying their index into the
    // newest-first `listedMessages`. The minimap item source.
    const loadedUserMessages = React.useMemo<LoadedUserMessage[]>(() => {
        return listedMessages
            .map((message, index) => message.kind === 'user-text'
                ? { message, index }
                : null)
            .filter((item): item is LoadedUserMessage => item !== null)
            .reverse();
    }, [listedMessages]);

    // AskUserQuestion calls the rail places a marker for, in the same ascending order as
    // `loadedUserMessages`. Sub-agent (sidechain) questions live inside their parent's children and
    // are never top-level list rows, so they are not jump targets either.
    const loadedQuestionMessages = React.useMemo<MinimapMessage[]>(() => {
        return listedMessages
            .filter(isAskUserQuestionToolCall)
            .map(toAskUserQuestionMessage)
            .filter((message): message is AskUserQuestionMessage => message !== null)
            .reverse();
    }, [listedMessages]);

    // `preview_html` calls the rail places a marker for, in the same ascending order. Only calls
    // that produced a document qualify — see buildPreviewHtmlMessage.
    const loadedPreviewMessages = React.useMemo<MinimapMessage[]>(() => {
        return listedMessages
            .filter(isPreviewHtmlToolCall)
            .map(toPreviewHtmlMessage)
            .filter((message): message is PreviewHtmlMessage => message !== null)
            .reverse();
    }, [listedMessages]);

    // `ExitPlanMode` calls the rail places a marker for, in the same ascending order. Only calls
    // that carry a plan qualify — see buildPlanProposalMessage.
    const loadedPlanMessages = React.useMemo<MinimapMessage[]>(() => {
        return listedMessages
            .filter(isExitPlanModeToolCall)
            .map(toPlanProposalMessage)
            .filter((message): message is PlanProposalMessage => message !== null)
            .reverse();
    }, [listedMessages]);

    // Merge offline-cached landmarks with the loaded ones so the minimap can show prompts,
    // questions, previews and plan proposals that live in the persistent cache but haven't been
    // paged into the list yet. Loaded messages win on id (they carry an accurate scroll position);
    // rows the rail leaves out (see shouldHideMessageInMinimap) are dropped from both sources.
    const minimapItems = React.useMemo<ConversationMinimapItem[]>(() => {
        // Loaded messages always win (they carry the store's id → accurate scroll position + active
        // highlight). A cached entry is dropped if a loaded message matches it by EITHER seq OR
        // localId: the same message can be represented differently on each side (e.g. loaded is the
        // just-sent optimistic copy with a localId and no seq, cache has the acked copy with a seq),
        // so a single-key match would leak duplicates.
        const loadedBySeq = new Set<number>();
        const loadedByLocalId = new Set<string>();
        const merged: MinimapMessage[] = [];
        for (const loaded of [
            ...loadedUserMessages.map((item) => item.message),
            ...loadedQuestionMessages,
            ...loadedPreviewMessages,
            ...loadedPlanMessages,
        ]) {
            if (shouldHideMessageInMinimap(loaded)) continue;
            merged.push(loaded);
            if (loaded.seq != null) loadedBySeq.add(loaded.seq);
            if (loaded.localId) loadedByLocalId.add(loaded.localId);
        }
        for (const cached of props.minimapCachedUserMessages ?? []) {
            if (shouldHideMessageInMinimap(cached)) continue;
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
    }, [props.minimapCachedUserMessages, loadedUserMessages, loadedQuestionMessages, loadedPreviewMessages, loadedPlanMessages]);
    // Landmark rows in the list's own order — newest first — carrying the index each has there. Only a
    // row the rail draws a mark for counts, so the landmark the rail is told to light is always one it
    // has; the rail's current landmark is read off these and the rows on screen, see `currentLandmark`.
    const landmarkRows = React.useMemo(
        () => railLandmarkRows(listedMessages, new Set(minimapItems.map((item) => item.message.id))),
        [listedMessages, minimapItems],
    );
    const landmarkRowsRef = useRef(landmarkRows);
    landmarkRowsRef.current = landmarkRows;
    const activeMessageIdRef = useRef<string | null>(null);

    // ---- Virtualizer model ----

    // Chronological (oldest-first) entry keys for the layout model.
    const entryKeys = React.useMemo(() => {
        const keys = new Array<string>(listedMessages.length);
        for (let i = 0; i < listedMessages.length; i++) {
            keys[listedMessages.length - 1 - i] = listedMessages[i].id;
        }
        return keys;
    }, [listedMessages]);

    // Session restore state, read once at mount (the component remounts per session).
    const [restored] = useState(() => sessionRestoreStates.get(props.sessionId));
    const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(() => restored?.heightsByKey ?? {});
    const measuredHeightsRef = useRef(measuredHeights);
    measuredHeightsRef.current = measuredHeights;

    const layout = React.useMemo(
        () => buildLayoutModel({
            keys: entryKeys,
            measuredHeightsByKey: measuredHeights,
            estimateHeightPx: ROW_ESTIMATE_PX,
            collapsedKeys: folding.hiddenIds,
        }),
        [entryKeys, measuredHeights, folding.hiddenIds]
    );
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // The measured footer height, as state: it is part of the canvas's fill minimum (below), so
    // changing it has to re-render. Kept in step with footerHeightRef, which the distance math
    // reads because it must stay fresh inside event handlers.
    const [footerHeightPx, setFooterHeightPx] = useState(0);

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

    // ---- Canvas geometry (architecture note 3) ----
    // Derived, never stored: the canvas is the model plus the fill a short conversation needs to sit
    // at the bottom of the viewport. With no frozen state there is nothing to re-sync, and the
    // scroll range always covers the content — a range change can never strand the viewport outside
    // it. Both inputs are state, so this re-derives in the same commit that resized either.
    const canvasHeightPx = Math.max(
        layout.totalHeightPx,
        minimumCanvasHeightPx({
            viewportHeightPx: viewport.viewportHeightPx,
            headerInsetPx,
            footerHeightPx,
        }),
    );

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
    const lastSeenTimestampRef = useRef<number>(listedMessages[0]?.createdAt ?? 0);
    const isLoadingMoreRef = useRef(false);
    const [isLocating, setIsLocating] = useState(false);

    // Calculate unread count: count messages newer than the last seen timestamp
    let unreadCount = 0;
    if (showScrollButton) {
        for (const msg of listedMessages) {
            if (msg.createdAt > lastSeenTimestampRef.current) {
                unreadCount++;
            } else {
                break; // messages are sorted newest-first, no need to continue
            }
        }
    }

    // ---- Coordinate helpers ----

    // The distance the scroller was TOLD to be at, kept apart from the distance it reports: a write
    // the engine rounds (fractional scrollTop, a range it has not laid out, either end) is remembered
    // as an intent, and reads answer with the intent while the DOM still holds the rounding. Every
    // correction below then starts from the intent, so a rounding is spent once instead of becoming
    // the next correction's starting point — which is what a drift is made of. The record dies the
    // moment the DOM reports something else, i.e. as soon as the reader scrolls.
    const scrollDistanceRef = useRef(createScrollDistanceController({
        getElement: () => scrollerElRef.current,
    }));
    const scrollDistance = scrollDistanceRef.current;
    const getRequestedRawDistance = () => scrollDistance.getRequestedDistancePx();

    const getRawDistance = () => {
        const scroller = scrollerElRef.current;
        return scroller ? Math.abs(scroller.scrollTop) : 0;
    };
    // See lastVisibleRawRef: a hidden (covered-screen) scroller has no box.
    const isScrollerHidden = () => {
        const scroller = scrollerElRef.current;
        return !scroller || scroller.clientHeight === 0;
    };
    // The footer is a sibling BELOW the canvas, so it is the constant between the two coordinates:
    // raw distance counts from the content column's bottom (the footer's own bottom edge), model
    // distance from the content's bottom (the newest row's bottom edge). One conversion each way.
    const toModelDistance = (raw: number) => Math.max(0, raw - footerHeightRef.current);
    const fromModelDistance = (model: number) => model + footerHeightRef.current;
    const setRawDistance = (raw: number) => {
        const scroller = scrollerElRef.current;
        // Hidden: the write would be dropped and the 0 read-back would corrupt
        // atBottom (a boxless scroller always reads "at bottom").
        if (!scroller || scroller.clientHeight === 0) return;
        // The controller owns the write so that what the engine does with it is
        // remembered rather than lost (see scrollDistanceRef above).
        const actual = scrollDistance.setDistancePx(raw);
        atBottomRef.current = actual <= SCROLL_THRESHOLD;
        lastVisibleRawRef.current = actual;
    };

    const cancelScrollAnimation = () => {
        if (scrollAnimationFrameRef.current != null) {
            window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
        }
        isAnimatingScrollRef.current = false;
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
    const proxyScrollIntentRef = useRef(createProxyScrollIntent(GESTURE_QUIET_MS));
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
        const target = Math.max(0, Math.min(maxTop, maxTop - getRawDistance()));
        if (Math.abs(proxy.scrollTop - target) > 1) {
            proxy.scrollTop = target;
            proxySelfWriteRef.current = { topPx: proxy.scrollTop, atMs: performance.now() };
        }
    };
    const syncProxyFromRealRef = useRef(syncProxyFromReal);
    syncProxyFromRealRef.current = syncProxyFromReal;

    // Proxy → real: the user drags the proxy thumb, clicks its track or
    // wheels over the strip. Both sides count the same distance from the same
    // content bottom, so a position routes straight across.
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
        if (!proxyScrollIntentRef.current.acceptScroll(performance.now())) {
            // Safari can deliver an old proxy offset after a jump. The real
            // list remains authoritative unless the user operated the proxy.
            syncProxyFromRealRef.current();
            return;
        }
        lastUserInputAtRef.current = performance.now();
        pendingRestoreRef.current = null;
        cancelScrollAnimation();
        const maxTop = Math.max(0, proxyGhostHeightRef.current - proxy.clientHeight);
        const content = Math.max(0, maxTop - top);
        setRawDistance(content);
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
            proxyScrollIntentRef.current.pointerDown(performance.now());
            proxySelfWriteRef.current = null;
            proxyDraggingRef.current = true;
            lastUserInputAtRef.current = performance.now();
            pendingRestoreRef.current = null;
            cancelScrollAnimation();
        };
        const onPointerUp = () => {
            if (!proxyDraggingRef.current) return;
            proxyScrollIntentRef.current.pointerUp(performance.now());
            handleProxyScrollRef.current();
            proxyDraggingRef.current = false;
            syncProxyFromRealRef.current();
        };
        const onWheel = () => {
            proxyScrollIntentRef.current.input(performance.now());
            proxySelfWriteRef.current = null;
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (SCROLL_KEYS.has(event.key)) onWheel();
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        el.addEventListener('pointerdown', onPointerDown, { passive: true });
        el.addEventListener('wheel', onWheel, { passive: true });
        el.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerup', onPointerUp, { passive: true });
        window.addEventListener('pointercancel', onPointerUp, { passive: true });
        detachProxyListenersRef.current = () => {
            el.removeEventListener('scroll', onScroll);
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('keydown', onKeyDown);
            proxyScrollIntentRef.current.cancel();
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

    // Apply a batch of measured row heights: update the height cache, rebuild the model, and move the
    // viewport by the one number the heights below the reader's line add up to.
    //
    // The rule is the reference's, and the whole of it is `heightDeltaPx`. Every measured entry whose
    // bottom edge sits at or below the absorption line contributes its height delta, and the viewport
    // moves by that sum and nothing else. Which makes the absorption line the load-bearing value: it
    // is the bottom edge of the topmost MEASURED entry inside the viewport, not the viewport's own
    // edge. A row that is on screen and measured is one the reader can see, so a change below it is a
    // change they did not ask to look at, and holding that row still is what keeps the answer below
    // it from sliding out from under the line they are reading at.
    //
    // Every term is a number we own: the line comes from the model, the deltas come from the model,
    // and the distance the sum is added to is the distance we last asked the scroller for, never the
    // one it reported back. That last part is the difference between a correction and a drift.
    const applyMeasuredHeights = (batch: Map<string, { element: HTMLElement; heightPx: number }>, useFlushSyncCommit: boolean): boolean => {
        const current = measuredHeightsRef.current;
        const layoutNow = layoutRef.current;
        const viewportNow = viewportRef.current;
        const rawNow = getRawDistance();
        const restoreMode = pendingRestoreRef.current != null;
        const withinGrace = performance.now() - lastUserInputAtRef.current < USER_SCROLL_GRACE_MS;
        const pinToBottom = !restoreMode && atBottomRef.current && (!withinGrace || rawNow === 0);
        // A pending jump is about to place the viewport itself, out of a layout built from this very
        // batch, so no measurement here is "below the viewport" in a sense the correction may act on
        // and taking one for that would move the screen twice. A restore is the same: the saved
        // offset is the truth, and the reader's position is not ours to correct on the way there.
        const viewportOwned = pendingJumpRef.current != null || restoreMode;
        let absorptionLinePx = viewportNow.distanceFromBottomPx;
        let anchorIndex: number | null = null;
        if (!viewportOwned) {
            const anchorKey = pickCompensationAnchor({
                previousLayout: layoutNow,
                nextLayout: layoutNow,
                distanceFromBottomPx: absorptionLinePx,
                viewportHeightPx: viewportNow.viewportHeightPx,
                measuredHeightsByKey: current,
                collapseEmptyRows: true,
            });
            anchorIndex = anchorKey == null ? null : layoutNow.indexByKey.get(anchorKey) ?? null;
            // Nothing measured on screen: fall back to the viewport's own edge. Content above the line
            // can then slide rather than stay put, but the line is still ours and nothing accumulates.
            if (anchorIndex != null) absorptionLinePx = layoutNow.bottomOffsetsPx[anchorIndex] ?? absorptionLinePx;
        }
        // Whether the anchor's own top edge is on screen. A row taller than the viewport has two
        // edges and the line can only hold one of them: absorbing the row's own change holds its TOP,
        // which for a row the reader has already scrolled past is an edge they cannot see — and it
        // carries everything below the row away by the height the row just gave up. Such a row is
        // left out of the sum instead, so the distance from the bottom does not move and the edge the
        // reader can see — the one they tapped under — is the one that stays.
        const anchorTopPx = anchorIndex == null
            ? null
            : (layoutNow.bottomOffsetsPx[anchorIndex] ?? 0) + (layoutNow.heightsPx[anchorIndex] ?? 0);
        const anchorTopOnScreen = anchorTopPx == null
            || anchorTopPx <= viewportNow.distanceFromBottomPx + viewportNow.viewportHeightPx + ANCHOR_TOP_SLACK_PX;
        let next = current;
        let heightDeltaPx = 0;
        // A row whose height is being animated is one the observer has no opinion about: it reports
        // the body at the size the animation has drawn so far, frame after frame, and every one of
        // those would look like a measurement. The animation settles the row itself when it ends.
        const suppressedKeys = foldAnim.suppressedKeysRef.current;
        for (const [key, { element, heightPx }] of batch) {
            if (rowElsByKeyRef.current.get(key) !== element) continue;
            if (suppressedKeys.has(key)) continue;
            const height = Math.max(1, heightPx);
            if (next[key] === height) continue;
            if (next === current) next = { ...current };
            next[key] = height;
            const index = layoutNow.indexByKey.get(key);
            if (index == null) continue;
            const deltaVsLayout = height - (layoutNow.heightsPx[index] ?? height);
            if (deltaVsLayout !== 0 && !viewportOwned && (layoutNow.bottomOffsetsPx[index] ?? 0) <= absorptionLinePx
                && (index !== anchorIndex || anchorTopOnScreen)) {
                heightDeltaPx += deltaVsLayout;
            }
        }
        if (next === current) return false;

        const staged = pendingOpsRef.current;
        // The distance this commit is added to: the last one we asked for. With nothing to add the
        // previous intent is kept rather than re-derived, so even a batch that changes no height
        // cannot pull one of the engine's roundings back into the arithmetic.
        const intentRawPx = staged?.scrollDistancePx ?? getRequestedRawDistance();
        const wantedRawPx = Math.max(0, intentRawPx + heightDeltaPx);
        const movingDistance = !viewportOwned && !pinToBottom && (heightDeltaPx !== 0 || staged != null);
        const nextLayout = buildLayoutModel({
            keys: layoutNow.keys,
            measuredHeightsByKey: next,
            estimateHeightPx: ROW_ESTIMATE_PX,
            // The same folds the render builds its layout with: without them a measurement commit
            // would hand every folded row its height back, and the viewport would move by the whole
            // of the fold on the next thing that measured anything.
            collapsedKeys: hiddenIdsRef.current,
        });
        const targetModel = restoreMode
            ? Math.max(0, (pendingRestoreRef.current ?? 0) - footerHeightRef.current)
            : pinToBottom
                ? 0
                : Math.max(0, wantedRawPx - footerHeightRef.current);
        const nextViewport = nextViewportState({
            current: viewportNow,
            layout: nextLayout,
            distanceFromBottomPx: targetModel,
            viewportHeightPx: viewportNow.viewportHeightPx,
            overscanCount: OVERSCAN_ROWS,
        });
        pendingOpsRef.current = {
            restore: restoreMode,
            pinToBottom,
            heights: next,
            scrollDistancePx: pinToBottom ? 0 : wantedRawPx,
        };
        // A batch whose height changes are all ABOVE the reader's line leaves the distance alone, and
        // in bottom-anchored coordinates that is the whole story: every row at or below them keeps its
        // distance from the bottom, so the content grows or shrinks out of the way without moving
        // what is on screen, and the canvas — now the model's own height — takes the range with it.
        if (movingDistance) setRawDistance(wantedRawPx);
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
        setRawDistance(target);
        const actual = getRequestedRawDistance();
        if (Math.abs(actual - target) <= RESTORE_TOLERANCE_PX) {
            pendingRestoreRef.current = null;
        } else if (!props.hasMore
            && scroller.scrollHeight - scroller.clientHeight < target - RESTORE_TOLERANCE_PX) {
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
    // content changes while covered cannot move it).
    const maybeHandleReshow = (): boolean => {
        if (!scrollerWasHiddenRef.current) return false;
        const scroller = scrollerElRef.current;
        if (!scroller || scroller.clientHeight === 0) return false;
        scrollerWasHiddenRef.current = false;
        if (pendingRestoreRef.current == null && !atBottomRef.current) {
            pendingRestoreRef.current = lastVisibleRawRef.current;
        }
        reassertPendingRestoreRef.current();
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        syncProxyFromRealRef.current();
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
    const onActiveMessageIdChangeRef = useRef(props.onActiveMessageIdChange);
    onActiveMessageIdChangeRef.current = props.onActiveMessageIdChange;

    const recomputeActiveIds = useCallback(() => {
        const items = listedMessagesRef.current;
        const indexById = new Map<string, number>();
        items.forEach((message, index) => indexById.set(message.id, index));

        const visibleIndexes: number[] = [];
        for (const id of visibleIdsRef.current) {
            const index = indexById.get(id);
            if (index != null) visibleIndexes.push(index);
        }

        // Which landmark the reader is on is a question about the whole list — where they sit among its
        // landmarks — not about the rows that happen to be on screen; see `currentLandmark`. The marker
        // follows them back through prompts, questions and previews alike, so no landmark on the rail is
        // unreachable.
        const next = currentLandmark(landmarkRowsRef.current, visibleIndexes);
        // Nothing measured at all, which the observer reports now and then as rows mount: keep the last
        // answer rather than flicking the rail to an endpoint.
        if (next === null || next === activeMessageIdRef.current) return;
        activeMessageIdRef.current = next;
        onActiveMessageIdChangeRef.current?.(next);
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
        const raw = Math.abs(scroller.scrollTop);
        lastVisibleRawRef.current = raw;
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
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        maybeLoadMoreRef.current();
        syncProxyFromRealRef.current();
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
            // Wheel input keeps arriving even when scrollTop is clamped at the
            // top of the scroll range (where scroll events go silent) — it must
            // still be able to keep paging.
            const onWheel = () => {
                maybeHandleReshowRef.current();
                onUserInput();
                maybeLoadMoreRef.current();
            };
            el.addEventListener('scroll', onScroll, { passive: true });
            el.addEventListener('wheel', onWheel, { passive: true });
            el.addEventListener('touchstart', onUserInput, { passive: true });
            el.addEventListener('pointerdown', onUserInput, { passive: true });
            detachScrollerListenersRef.current = () => {
                el.removeEventListener('scroll', onScroll);
                el.removeEventListener('wheel', onWheel);
                el.removeEventListener('touchstart', onUserInput);
                el.removeEventListener('pointerdown', onUserInput);
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

    // Footer block at the content bottom: its height is the raw↔model offset, and its growth below
    // a scrolled-up viewport must be compensated (at the bottom, scrollTop 0 tracks it
    // structurally). It also feeds the canvas's fill minimum, hence the state.
    const footerResizeObserverRef = useRef<ResizeObserver | null>(null);
    const handleFooterEl = useCallback((el: HTMLDivElement | null) => {
        footerResizeObserverRef.current?.disconnect();
        footerResizeObserverRef.current = null;
        if (!el) return;
        const measured = el.offsetHeight;
        if (measured > 0 && measured !== footerHeightRef.current) {
            footerHeightRef.current = measured;
            setFooterHeightPx(measured);
        }
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
            setFooterHeightPx(height);
            const delta = height - prev;
            syncProxyFromRealRef.current();
            if (delta === 0 || isAnimatingScrollRef.current) return;
            if (atBottomRef.current || pendingRestoreRef.current != null) return;
            // The footer sits below the canvas, so growing it pushes the content up in raw
            // coordinates by exactly its delta: add that to the distance we last asked for, so the
            // reader's row does not move.
            setRawDistance(getRequestedRawDistance() + delta);
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
    }, [listedMessages]);

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
    const startJump = (target: MinimapMessage): boolean => {
        const message = listedMessagesRef.current.find((m) => messageMatchesTarget(m, target));
        if (!message) return false;
        cancelScrollAnimation();
        pendingRestoreRef.current = null;
        const jump: PendingJump = { key: message.id, nonce: ++jumpNonceRef.current, silent: false };
        pendingJumpRef.current = jump;
        setPendingJump(jump);
        return true;
    };
    const startJumpRef = useRef(startJump);
    startJumpRef.current = startJump;


    // A tap on the fold line is nothing but a height change: the rows below the line take no height,
    // or take theirs back, and the layout effect absorbs exactly that much into the viewport (see
    // `applyMeasuredHeights`, which the layout effect shares its rule with). Nothing here reads the
    // row's position on screen and nothing writes the scroller — reading a position back and aiming
    // for it is what turned every tap into a fresh chance to import the engine's rounding, and what
    // made the line creep a little further with each one.
    //
    // The animation is the same heights walked down (or back up) in a couple of hundred
    // milliseconds, on the rows themselves: it changes where nothing ends up — the fold is in the
    // model from the first frame, so the layout effect has already absorbed all of it — and it
    // cannot move the line the reader tapped, because every row it takes lies below that line and
    // the line's own row animates the content hanging under it (see `useFoldAnimation`).
    const handleToggleFold = React.useCallback((headerId: string) => {
        const tap = foldTapRef.current.get(headerId);
        if (tap) {
            // The line's own row is one of the rows the fold takes — unless the fold leaves it
            // standing, in which case its content stays and only the process below it goes.
            const keys = tap.keepsRow ? tap.hiddenIds : [headerId, ...tap.hiddenIds];
            // The state the row is in *now* decides which way the bodies are about to go.
            foldAnim.start({ keys, direction: tap.folded ? 'expanding' : 'collapsing' });
        }
        folding.toggle(headerId);
        // `folding.toggle` and not `folding`: the object is rebuilt every render, so depending on it
        // would hand every mounted row a new callback prop on every commit and defeat their memo.
    }, [folding.toggle, foldAnim.start]);

    // The target of the in-flight jump. A second minimap click updates this so the running paging
    // loop retargets instead of the click being silently dropped.
    const activeJumpTargetRef = useRef<MinimapMessage | null>(null);
    const handleJumpToMessage = useCallback(async (target: MinimapMessage) => {
        proxyScrollIntentRef.current.cancel();
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
                // Let the store subscription flush into listedMessagesRef before re-checking.
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
                // The store commit must reach listedMessagesRef (a React render) before the jump
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

    // Where a pending jump wants the viewport, for both the render override below (which mounts
    // the target in the same commit that asked for it) and the landing effect (which positions it
    // from exact heights). One mapping, so the two can never disagree.
    const jumpDistanceFor = (jump: PendingJump, viewportHeightPx: number): number | null =>
        distanceToCenterEntry({ layout, key: jump.key, viewportHeightPx });

    // ---- Render-phase window overrides ----
    // A pending jump mounts its target in the SAME commit that requested it;
    // an entry-set change remaps the window to follow its anchor key (indices
    // shift on prepends).
    let renderedRange: RenderRange = viewport.renderedRange;
    if (pendingJump != null) {
        const jumpDistance = jumpDistanceFor(pendingJump, viewport.viewportHeightPx);
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

    // 1. Layout changes nothing measured: a fold, a new message, a page
    // prepend. Keep the first measured on-screen row's top edge still, which
    // is the same rule `applyMeasuredHeights` applies to a measurement batch —
    // what changed at or below the reader's line moves the viewport, what
    // changed above it does not. Prepends are naturally free in bottom-anchored
    // coordinates (delta 0); appends below a scrolled-up viewport get
    // compensated; at the bottom, glue to 0.
    React.useLayoutEffect(() => {
        const previous = committedLayoutRef.current;
        const next = preMeasureLayoutRef.current ?? layout;
        preMeasureLayoutRef.current = null;
        committedLayoutRef.current = layout;
        syncProxyFromRealRef.current();
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
            collapseEmptyRows: true,
        });
        if (!anchorKey) return;
        const prevTop = entryTopFromBottom(previous, anchorKey);
        const nextTop = entryTopFromBottom(next, anchorKey);
        if (prevTop == null || nextTop == null || nextTop === prevTop) return;
        // The anchor's distance-from-bottom moved (appends/removals below the
        // viewport; prepends are delta 0 by construction). Add the shift to the
        // distance we last asked for — the same arithmetic as a measurement
        // batch's, on the same number — so the rows at and above the anchor
        // keep their place while everything below it slides with it.
        const shiftedRawPx = Math.max(0, getRequestedRawDistance() + (nextTop - prevTop));
        setRawDistance(shiftedRawPx);
        updateViewportRef.current(shiftedRawPx, scroller.clientHeight);
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

    // 3. A fold's animation has just ended: measure the rows it was drawing.
    //
    // Their heights were the animation's to draw, so the observer's reports were set aside for the
    // duration (see `applyMeasuredHeights`). What it ends on is the truth — by now the row the line
    // sits on has given up its content, and the rows the fold took are gone entirely — so the model
    // takes those heights here, in the same pre-paint pass. It has to: the model held the row at the
    // height it had while opening, and the next measurement of it might be far away.
    //
    // Nothing moves because of it. The viewport holds a row by keeping the distance it was asked for
    // in step with the sum of the heights at or below that row, and this measurement changes both by
    // the same number — so the reading position the reader chose survives the fold, however many
    // times they fold it.
    React.useLayoutEffect(() => {
        const settledRows = foldAnim.takeSettled();
        if (settledRows == null) return;
        const batch = new Map<string, { element: HTMLElement; heightPx: number }>();
        for (const row of settledRows) {
            const el = rowElsByKeyRef.current.get(row.key);
            if (!el) continue;
            // The border box the observer would have reported, unrounded: the row's own box — the
            // element the observer watches, which the clip never reached — never the number the
            // animation was writing, which was never a measurement of anything.
            const heightPx = el.getBoundingClientRect().height;
            if (heightPx > 0) batch.set(row.key, { element: el, heightPx });
        }
        if (batch.size > 0) applyMeasuredHeightsRef.current(batch, false);
        // The clip has done its work: the rows still mounted go back to sizing themselves — read off
        // the elements the animation kept, since the rows that stopped animating in this very commit
        // have already had their refs taken away.
        foldAnim.releaseKeys(settledRows);
    }, [foldAnim.animatingIds]);

    // 4. Drain staged measurement ops right after the commit, before paint:
    // re-assert a pending restore or pin back to the bottom. Everything else
    // was already folded into the distance the commit wrote.
    React.useLayoutEffect(() => {
        const ops = pendingOpsRef.current;
        if (!ops || ops.heights !== measuredHeights) return;
        pendingOpsRef.current = null;
        if (ops.restore) {
            reassertPendingRestoreRef.current();
        } else if (ops.pinToBottom && !isAnimatingScrollRef.current) {
            setRawDistance(0);
        }
    }, [measuredHeights]);

    // 5. Commit the render-phase window remap after entry-set changes and
    // re-assert a pending restore (more content may make it reachable now).
    React.useLayoutEffect(() => {
        if (pendingJumpRef.current) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        if (!pendingOpsRef.current) reassertPendingRestoreRef.current();
    }, [entryKeys]);

    // 6. Initial mount: apply the saved scroll offset before first paint, once
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

    // 7. Execute a pending jump: the render override above already mounted the
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
        const staged = applyMeasuredHeightsRef.current(batch, false);
        if (staged || pendingOpsRef.current) return;
        const modelDistance = jumpDistanceFor(jump, scroller.clientHeight);
        const clearJump = () => queueMicrotask(() => {
            if (pendingJumpRef.current === jump) pendingJumpRef.current = null;
            setPendingJump((current) => (current === jump ? null : current));
        });
        if (modelDistance == null) {
            clearJump();
            return;
        }
        const wantedRaw = Math.max(0, fromModelDistance(modelDistance));
        setRawDistance(wantedRaw);
        jump.attempts = (jump.attempts ?? 0) + 1;
        // The range covers the whole content, so the only way this reads back short is a write the
        // engine dropped outright (a hidden scroller): the effect runs on every commit, so the next
        // one positions the jump again.
        if (Math.abs(getRequestedRawDistance() - wantedRaw) > JUMP_LAND_TOLERANCE_PX
            && jump.attempts < MAX_JUMP_ATTEMPTS) {
            return;
        }
        updateViewportRef.current(Math.abs(scroller.scrollTop), scroller.clientHeight);
        if (!jump.silent) {
            shakeRow(jump.key);
            if (__DEV__) {
                console.log('[ChatList] jump landed', { key: jump.key, raw: Math.round(wantedRaw) });
            }
        }
        clearJump();
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
            pendingRestoreRef.current = null;
            cancelScrollAnimation();
            // Same duty as the wheel listener: at the top of the scroll range
            // scroll events go silent, key events must keep paging.
            maybeLoadMoreRef.current();
        };
        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Dev-only diagnostics: window.__chatListGeometry() dumps the scroll
    // geometry the probes read (distances, the mounted window, the honest
    // scrollHeight next to the model's total).
    React.useEffect(() => {
        if (!__DEV__) return;
        const host = window as unknown as Record<string, unknown>;
        host.__chatListGeometry = () => {
            const scroller = scrollerElRef.current;
            const vp = viewportRef.current;
            return {
                totalHeightPx: layoutRef.current.totalHeightPx,
                scrollHeightPx: scroller?.scrollHeight ?? 0,
                viewportHeightPx: vp.viewportHeightPx,
                distanceFromBottomPx: vp.distanceFromBottomPx,
                requestedDistancePx: getRequestedRawDistance(),
                renderedRange: [vp.renderedRange.startIndex, vp.renderedRange.endIndex],
            };
        };
        return () => { delete host.__chatListGeometry; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        props.onMinimapItemsChange?.(minimapItems);

        // A landmark the rail no longer carries cannot be marked — the reader was on it and it has left
        // the rail (a summary dropped by the list filter, a page reloaded away) — so rest on the newest.
        const activeId = activeMessageIdRef.current;
        if (activeId !== null && minimapItems.some((item) => item.message.id === activeId)) return;

        const newest = minimapItems[minimapItems.length - 1];
        activeMessageIdRef.current = newest ? newest.message.id : null;
        props.onActiveMessageIdChange?.(activeMessageIdRef.current);
    }, [props.onMinimapItemsChange, props.onActiveMessageIdChange, minimapItems]);

    React.useEffect(() => {
        const controller = createScrollButtonVisibilityController({
            showDelayMs: SHOW_SCROLL_BUTTON_DELAY_MS,
            onShow: () => {
                setShowScrollButton((prev) => {
                    if (prev) return prev;
                    lastSeenTimestampRef.current = listedMessagesRef.current[0]?.createdAt ?? 0;
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
                ? Math.abs(scroller.scrollTop)
                : lastVisibleRawRef.current,
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
        if (start <= RESTORE_TOLERANCE_PX
            || start > SCROLL_TO_BOTTOM_ANIMATE_MAX_VIEWPORTS * scroller.clientHeight) {
            // Already there — or too far for the animation to read as motion: land instantly.
            // Distance 0 is estimate-free in bottom-anchored coordinates, so the teleport is exact.
            setRawDistance(0);
            updateViewportRef.current(0, scroller.clientHeight);
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
                // The animation writes scrollTop directly, so the intent is
                // settled here rather than left at whatever frame it stopped on.
                setRawDistance(0);
                updateViewportRef.current(0, el.clientHeight);
            }
        };
        scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
    }, []);

    // ---- Render ----

    const rows: React.ReactNode[] = [];
    for (let entryIndex = renderedRange.startIndex; entryIndex < renderedRange.endIndex; entryIndex++) {
        const messageIndex = listedMessages.length - 1 - entryIndex;
        const item = listedMessages[messageIndex];
        if (!item) continue;
        // A row mid-fold is still the row itself, at whatever height the animation has drawn: that
        // is what the reader is watching, and it is the same element either way.
        const foldAnimating = foldAnim.animatingIds.has(item.id);
        // Folded away: the row holds its place in the model at no height, and nothing else about it
        // is mounted — no message view to lay out, no row for the observer to measure. Its height
        // lives on in `measuredHeights`, which is where it grows back from.
        if (!foldAnimating && folding.hiddenIds.has(item.id)) {
            rows.push(<div key={item.id} aria-hidden style={{ height: 0, overflow: 'hidden' }} />);
            continue;
        }
        // Agent turns show the action bar only on their last text segment, and
        // only once the turn settled — a reply still being generated is not a
        // finished message. User messages always show it.
        const isTurnEnd = item.kind === 'agent-text' && turns.completedIds.has(item.id);
        const showActionBar = item.kind === 'agent-text' ? isTurnEnd : true;
        const turnHeader = turnHeaderProps(turns.headerById.get(item.id));
        // Present only on the row that opens a turn whose process is worth folding.
        const fold = folding.controlByHeaderId.get(item.id);
        const process = turns.foldById.get(item.id);
        // The fold keeps a settled turn's answer and never swallows a row the reader answers. Either
        // can be the very row the line sits on — the turn's only text opening it, a question card or a
        // plan proposal opening it — and that row then shows its own content below the line instead of
        // giving way to it.
        const foldKeepsRow = foldedLineKeepsRow({
            folded: fold?.folded === true,
            answer: process?.answerId === item.id,
            landmark: isMinimapLandmarkRow(item),
        });
        if (fold) {
            foldTapRef.current.set(item.id, {
                hiddenIds: process?.hiddenIds ?? [],
                keepsRow: foldKeepsRow,
                folded: fold.folded,
            });
        }
        // While the fold is closing, the row the line sits on keeps its content — clipped away by
        // the animation rather than taken away in a single frame. The fold is what the model already
        // knows; this is only what the reader is shown while it happens.
        const foldKeepsRowNow = foldKeepsRow || (foldAnimating && fold?.folded === true);
        // A running turn folds to its line alone, so the line says what the turn is doing. Once it
        // settles the answer is on screen and the line goes back to just its cost. The row the line
        // is drawn on is a candidate like any other — it is the turn's first step, and when it is the
        // only one, the line names it.
        const foldSnapshot = fold?.folded && turns.headerById.get(item.id)?.state === 'running'
            ? newestRowSnapshot({
                hiddenIds: process?.hiddenIds ?? [],
                lineRow: foldKeepsRow ? null : item,
                messageById,
                headlineOf: (tool) => toolTitle(tool, props.metadata),
            })
            : undefined;
        // The line divides the turn from its answer, so a folded turn with no answer to show — one
        // still running, or one that ended without a word — has nothing under the line to divide.
        const foldDivides = !(fold?.folded === true && process?.answerId == null);
        // Fork is offered on user prompts and on AI replies (private sessions
        // only; agent replies only via their action-bar segment).
        const canFork = !!props.onForkMessage && !props.isSharedSession
            && (item.kind === 'user-text' || isTurnEnd);
        const isNewestMessage = messageIndex === 0;
        // Stable per row, so handing it to a row cannot cost the row its memo.
        const foldAnimClipRef = foldAnimating ? foldAnim.clipRefFor(item.id) : undefined;
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
                foldFolded={fold?.folded}
                foldKeepsRow={foldKeepsRowNow}
                foldDivides={foldDivides}
                foldSteps={fold?.steps}
                foldSnapshot={foldSnapshot}
                onToggleFold={handleToggleFold}
                {...turnHeader}
                constrainedHeightPx={constrainedHeightPx}
                // The row the line is drawn on animates the content inside it; every other row
                // animates whole. Only a row the animation is actually playing on gets an element,
                // so the ref map holds the rows in flight and nothing else.
                outerRefCallback={foldAnimating && !fold ? foldAnimClipRef : undefined}
                foldBodyRef={foldAnimating && fold ? foldAnimClipRef : undefined}
                refCallback={getRowRefCallback(item.id)}
            />
        );
    }

    // Window position inside the canvas: the model's own top offset. The canvas is the model (or the
    // viewport fill a short conversation needs), so there is no slack left to shift it by.
    const windowMarginTopPx = layout.topOffsetsPx[renderedRange.startIndex] ?? layout.totalHeightPx;

    return (
        <View style={{ flex: 1 }}>
            {listedMessages.length === 0 ? (
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
                        {/* The spacer under the floating header is the only blank box above the
                            content, so the paging spinner lives at its bottom edge: absolutely
                            positioned, so mounting it can never resize the scroller, and inside the
                            spacer, so it can never cover a row. */}
                        <div style={{ height: headerInsetPx, flexShrink: 0, position: 'relative' }}>
                            {props.hasMore && (
                                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
                                    <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    </View>
                                </div>
                            )}
                        </div>
                        {/* The canvas: exactly the model's height (or the fill), so the scroll range
                            reaches every row. overflow:clip keeps transient window overflow out of
                            scrollHeight. */}
                        <div style={{ height: canvasHeightPx, position: 'relative', overflow: 'clip', flexShrink: 0 }}>
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
            {listedMessages.length > 0 && (
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
