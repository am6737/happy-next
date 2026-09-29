/** Keep native chat's follow-tail decision and return-to-bottom button on the same pixel boundary. */
export const CHAT_END_THRESHOLD_PX = 100;
export const CHAT_HISTORY_THRESHOLD = 0.5;

// Match ChatList.web.tsx: short returns are readable animations; long ones skip the history.
const CHAT_END_ANIMATION_MAX_VIEWPORTS = 3;

export function chatScrollToEndOptions(metrics: {
    contentLength: number;
    scroll: number;
    scrollLength: number;
}): { animated: boolean } {
    const distance = Math.max(0, metrics.contentLength - metrics.scroll - metrics.scrollLength);
    return {
        animated: metrics.scrollLength > 0 && distance > 1
            && distance <= CHAT_END_ANIMATION_MAX_VIEWPORTS * metrics.scrollLength,
    };
}

// This controls HOW an eligible automatic follow scrolls, not WHEN it follows. The 100px
// maintainScrollAtEndThreshold still owns eligibility, so reading history never opts into it.
export const CHAT_MAINTAIN_SCROLL_AT_END = { animated: true } as const;


export function chatEndThreshold(viewportHeight: number): number {
    return viewportHeight > 0 ? CHAT_END_THRESHOLD_PX / viewportHeight : 0;
}

/** Wait at most one second; null means React/LegendList still has the previous dataset. */
export async function waitForChatHistoryLayout(options: {
    readGeometry: () => string | null;
    isCancelled: () => boolean;
}): Promise<boolean> {
    let previousGeometry: string | null = null;
    for (let attempt = 0; attempt < 20 && !options.isCancelled(); attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        if (options.isCancelled()) return false;
        const geometry = options.readGeometry();
        if (geometry !== null && geometry === previousGeometry) return true;
        previousGeometry = geometry;
    }
    return false;
}

type HistorySnapshot = {
    oldestSeq: number | null;
    hasMore: boolean;
    nearStart: boolean;
};

/**
 * LegendList's reached-edge latch does not automatically refill a short page while still near the
 * edge. Continue explicitly, but only after the previous page has committed and layout has settled.
 * Minimap jumps share loadNext(), so both entry points use the same in-flight page.
 */
export function createChatHistoryPager(options: {
    read: () => HistorySnapshot;
    loadMore: () => void | Promise<void>;
    waitForLayout: () => Promise<boolean>;
    isJumping: () => boolean;
    onError: (error: unknown) => void;
    maxAutoPages?: number;
}) {
    let disposed = false;
    let inFlight: Promise<boolean> | null = null;
    let autoLoad: Promise<void> | null = null;

    function loadNext(): Promise<boolean> {
        if (disposed) return Promise.resolve(false);
        if (inFlight) return inFlight;
        const before = options.read();
        if (!before.hasMore || before.oldestSeq === null) return Promise.resolve(false);
        const beforeSeq = before.oldestSeq;
        // Defer invocation so even synchronous callbacks/re-entrant edge events see the lock.
        inFlight = Promise.resolve().then(async () => {
            if (disposed) return false;
            try {
                await options.loadMore();
                if (disposed) return false;
                const after = options.read();
                // A swallowed network error or an unavailable decryptor must not start a loop.
                if (after.oldestSeq === null || after.oldestSeq >= beforeSeq) return false;
                return true;
            } catch (error) {
                if (!disposed) options.onError(error);
                return false;
            }
        }).finally(() => { inFlight = null; });
        return inFlight;
    }

    function loadNearStart(): Promise<void> {
        if (autoLoad) return autoLoad;
        autoLoad = Promise.resolve().then(async () => {
            for (let page = 0; page < (options.maxAutoPages ?? 20); page++) {
                if (disposed || options.isJumping() || !options.read().nearStart) break;
                if (!await loadNext() || disposed || options.isJumping()) break;
                // Only automatic refill needs settled geometry. A far minimap jump must not
                // pay the native measurement delay on every intermediate history page.
                try {
                    if (!await options.waitForLayout()) break;
                } catch (error) {
                    if (!disposed) options.onError(error);
                    break;
                }
            }
        }).finally(() => { autoLoad = null; });
        return autoLoad;
    }

    return { loadNext, loadNearStart, dispose: () => { disposed = true; } };
}
