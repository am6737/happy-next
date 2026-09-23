import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_END_THRESHOLD_PX, CHAT_MAINTAIN_SCROLL_AT_END, chatEndThreshold, chatScrollToEndOptions, createChatHistoryPager, waitForChatHistoryLayout } from './chatListScrollController';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function setup(maxAutoPages?: number) {
    const state = { oldestSeq: 1000 as number | null, hasMore: true, nearStart: true };
    const loadMore = vi.fn(async () => { state.oldestSeq = state.oldestSeq! - 1; });
    const waitForLayout = vi.fn(async () => true);
    const isJumping = vi.fn(() => false);
    const onError = vi.fn();
    const pager = createChatHistoryPager({ read: () => ({ ...state }), loadMore, waitForLayout, isJumping, onError, maxAutoPages });
    return { state, loadMore, waitForLayout, isJumping, onError, pager };
}

describe('native chat end threshold', () => {
    it.each([300, 400, 667, 800, 1000, 1400])('keeps the boundary at 100px for a %ipx viewport', (height) => {
        expect(chatEndThreshold(height) * height).toBeCloseTo(CHAT_END_THRESHOLD_PX);
        expect(80 <= chatEndThreshold(height) * height).toBe(true);
        expect(120 > chatEndThreshold(height) * height).toBe(true);
    });

    it('handles pre-layout and keyboard resize without an infinite threshold', () => {
        expect(chatEndThreshold(0)).toBe(0);
        expect(chatEndThreshold(800)).toBe(0.125);
        expect(chatEndThreshold(400)).toBe(0.25);
    });
});

describe('native chat return-to-bottom animation', () => {
    it.each([80, 500, 1600, 2400])('smoothly scrolls a nearby %ipx distance', (distance) => {
        expect(chatScrollToEndOptions({ contentLength: 10000, scroll: 10000 - 800 - distance, scrollLength: 800 }))
            .toEqual({ animated: true });
    });

    it('jumps directly beyond three viewports', () => {
        expect(chatScrollToEndOptions({ contentLength: 10000, scroll: 6799, scrollLength: 800 }))
            .toEqual({ animated: false });
    });

    it('uses the current viewport after opening the keyboard or rotating', () => {
        expect(chatScrollToEndOptions({ contentLength: 10000, scroll: 8000, scrollLength: 800 }).animated).toBe(true);
        expect(chatScrollToEndOptions({ contentLength: 10000, scroll: 8000, scrollLength: 400 }).animated).toBe(false);
    });

    it.each([
        { contentLength: 300, scroll: 0, scrollLength: 800 },
        { contentLength: 1000, scroll: 200, scrollLength: 800 },
        { contentLength: 1000, scroll: 201, scrollLength: 800 },
        { contentLength: 1000, scroll: 0, scrollLength: 0 },
    ])('does not animate an already-reached end or an unmeasured viewport: %j', (metrics) => {
        expect(chatScrollToEndOptions(metrics)).toEqual({ animated: false });
    });

    it('enables smooth incoming-message following without widening its 100px eligibility', () => {
        expect(CHAT_MAINTAIN_SCROLL_AT_END).toEqual({ animated: true });
        for (const height of [400, 800, 1200]) {
            const followDistance = chatEndThreshold(height) * height;
            expect(80 <= followDistance).toBe(true);
            expect(120 <= followDistance).toBe(false);
        }
    });
});

describe('native chat history paging', () => {
    it('continues short pages without another reached-edge event, stopping once away from the top', async () => {
        const f = setup();
        f.waitForLayout.mockImplementation(async () => {
            if (f.loadMore.mock.calls.length === 3) f.state.nearStart = false;
            return true;
        });
        await f.pager.loadNearStart();
        expect(f.loadMore).toHaveBeenCalledTimes(3);
        expect(f.waitForLayout).toHaveBeenCalledTimes(3);
    });

    it('uses cursor progress even when a page has no visible messages', async () => {
        const f = setup();
        f.loadMore.mockImplementation(async () => {
            f.state.oldestSeq! -= 10;
            if (f.state.oldestSeq === 970) f.state.hasMore = false;
        });
        await f.pager.loadNearStart();
        expect(f.loadMore).toHaveBeenCalledTimes(3);
    });

    it('waits for the committed layout before deciding to load another page', async () => {
        const f = setup();
        const layout = deferred<boolean>();
        f.waitForLayout.mockReturnValue(layout.promise);
        const work = f.pager.loadNearStart();
        await vi.waitFor(() => expect(f.waitForLayout).toHaveBeenCalledOnce());
        expect(f.loadMore).toHaveBeenCalledOnce();
        f.state.nearStart = false;
        layout.resolve(true);
        await work;
        expect(f.loadMore).toHaveBeenCalledOnce();
    });

    it('coalesces repeated edge events and a minimap request into the same page', async () => {
        const f = setup();
        const network = deferred<void>();
        f.loadMore.mockImplementation(async () => { await network.promise; f.state.oldestSeq = f.state.oldestSeq! - 1; });
        const automatic = f.pager.loadNearStart();
        expect(f.pager.loadNearStart()).toBe(automatic);
        await vi.waitFor(() => expect(f.loadMore).toHaveBeenCalledOnce());
        const jumpPage = f.pager.loadNext();
        expect(f.pager.loadNext()).toBe(jumpPage);
        f.isJumping.mockReturnValue(true);
        network.resolve();
        await Promise.all([automatic, jumpPage]);
        expect(f.loadMore).toHaveBeenCalledOnce();
    });

    it('lets minimap load beyond the top threshold but pauses automatic loading during a jump', async () => {
        const f = setup();
        f.isJumping.mockReturnValue(true);
        await f.pager.loadNearStart();
        expect(f.loadMore).not.toHaveBeenCalled();
        f.state.nearStart = false;
        expect(await f.pager.loadNext()).toBe(true);
        expect(f.loadMore).toHaveBeenCalledOnce();
        expect(f.waitForLayout).not.toHaveBeenCalled();
    });

    it.each([null, 1000, 1001])('stops when the cursor does not advance (%s)', async (cursor) => {
        const f = setup();
        f.loadMore.mockImplementation(async () => { f.state.oldestSeq = cursor; });
        await f.pager.loadNearStart();
        expect(f.loadMore).toHaveBeenCalledOnce();
        expect(f.waitForLayout).not.toHaveBeenCalled();
    });

    it('stops on rejection and allows a later user-triggered retry', async () => {
        const f = setup();
        const error = new Error('offline');
        f.loadMore.mockRejectedValueOnce(error);
        await f.pager.loadNearStart();
        expect(f.loadMore).toHaveBeenCalledOnce();
        expect(f.onError).toHaveBeenCalledWith(error);
        expect(await f.pager.loadNext()).toBe(true);
        expect(f.loadMore).toHaveBeenCalledTimes(2);
    });

    it('handles a synchronous exception without leaving the loading lock set', async () => {
        const f = setup();
        f.loadMore.mockImplementationOnce(() => { throw new Error('sync failure'); });
        expect(await f.pager.loadNext()).toBe(false);
        expect(await f.pager.loadNext()).toBe(true);
    });

    it('does not load without a cursor, more history, or proximity to the top', async () => {
        const f = setup();
        f.state.oldestSeq = null;
        await f.pager.loadNearStart();
        f.state.oldestSeq = 100;
        f.state.hasMore = false;
        await f.pager.loadNearStart();
        f.state.hasMore = true;
        f.state.nearStart = false;
        await f.pager.loadNearStart();
        expect(f.loadMore).not.toHaveBeenCalled();
    });

    it('caps each automatic burst even if every page is hidden or very short', async () => {
        const f = setup();
        await f.pager.loadNearStart();
        expect(f.loadMore).toHaveBeenCalledTimes(20);
    });

    it('stops if layout does not settle', async () => {
        const f = setup();
        f.waitForLayout.mockResolvedValue(false);
        await f.pager.loadNearStart();
        expect(f.loadMore).toHaveBeenCalledOnce();
    });

    it('stops an in-flight burst when the session unmounts', async () => {
        const f = setup();
        const network = deferred<void>();
        f.loadMore.mockImplementation(async () => { await network.promise; f.state.oldestSeq = f.state.oldestSeq! - 1; });
        const work = f.pager.loadNearStart();
        await vi.waitFor(() => expect(f.loadMore).toHaveBeenCalledOnce());
        f.pager.dispose();
        network.resolve();
        await work;
        expect(f.waitForLayout).not.toHaveBeenCalled();
        expect(await f.pager.loadNext()).toBe(false);
        expect(f.loadMore).toHaveBeenCalledOnce();
    });
});

describe('history layout settling', () => {
    afterEach(() => vi.useRealTimers());

    it('waits through a delayed commit and measurement changes', async () => {
        vi.useFakeTimers();
        const readGeometry = vi.fn<() => string | null>()
            .mockReturnValueOnce(null).mockReturnValueOnce('1000:0:800')
            .mockReturnValueOnce('1200:200:800').mockReturnValue('1200:200:800');
        const work = waitForChatHistoryLayout({ readGeometry, isCancelled: () => false });
        await vi.runAllTimersAsync();
        expect(await work).toBe(true);
        expect(readGeometry).toHaveBeenCalledTimes(4);
    });

    it('times out rather than using stale list data', async () => {
        vi.useFakeTimers();
        const work = waitForChatHistoryLayout({ readGeometry: () => null, isCancelled: () => false });
        await vi.runAllTimersAsync();
        expect(await work).toBe(false);
    });

    it('cancels without reading an unmounted list', async () => {
        vi.useFakeTimers();
        let cancelled = false;
        const readGeometry = vi.fn(() => '1000:0:800');
        const work = waitForChatHistoryLayout({ readGeometry, isCancelled: () => cancelled });
        cancelled = true;
        await vi.runAllTimersAsync();
        expect(await work).toBe(false);
        expect(readGeometry).not.toHaveBeenCalled();
    });
});
