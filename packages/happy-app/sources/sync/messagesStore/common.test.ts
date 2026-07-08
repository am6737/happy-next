import { describe, expect, it } from 'vitest';
import type { MessagePage, SessionMessageCacheState } from './types';
import {
    buildCoverageStatePatch,
    cachedOlderPageReachesKnownStart,
    canServeCachedOlderPage,
    getCachedOlderPageUiHasMore,
    mergeOldestLoadedSeq,
} from './common';

function state(overrides: Partial<SessionMessageCacheState> = {}): SessionMessageCacheState {
    return {
        forwardMaxSeq: 300,
        oldestLoadedSeq: 1,
        hasMoreOlder: false,
        contiguousMinSeq: 1,
        contiguousMaxSeq: 300,
        remoteOldestSeq: 1,
        invalidatedAt: null,
        updatedAt: 1000,
        ...overrides,
    };
}

function page(length: number, overrides: Partial<MessagePage> = {}): MessagePage {
    return {
        messages: Array.from({ length }, (_, index) => ({
            id: `m${index + 1}`,
            seq: length - index,
            localId: null,
            content: { t: 'encrypted', c: `cipher-${index + 1}` },
            createdAt: 1000 + index,
            updatedAt: 1000 + index,
            sentBy: null,
            sentByName: null,
        })),
        minSeq: 1,
        maxSeq: length,
        hasMoreLocal: false,
        ...overrides,
    };
}

describe('message cache pagination helpers', () => {
    it('allows the final short cached page when cache state already reached the remote start', () => {
        const cachedState = state({ oldestLoadedSeq: 1, hasMoreOlder: false });
        const cachedPage = page(42, { minSeq: 1, maxSeq: 42, hasMoreLocal: false });

        expect(cachedOlderPageReachesKnownStart(cachedState, cachedPage)).toBe(true);
        expect(canServeCachedOlderPage(cachedPage, cachedState, 100)).toBe(true);
        expect(getCachedOlderPageUiHasMore(cachedPage, cachedState)).toBe(false);
    });

    it('does not trust an arbitrary short cached page when the server may still have older history', () => {
        const cachedState = state({ oldestLoadedSeq: 1, hasMoreOlder: true });
        const cachedPage = page(42, { minSeq: 1, maxSeq: 42, hasMoreLocal: false });

        expect(canServeCachedOlderPage(cachedPage, cachedState, 100)).toBe(false);
        expect(getCachedOlderPageUiHasMore(cachedPage, cachedState)).toBe(true);
    });

    it('does not serve a full local older page that does not connect to known coverage', () => {
        const cachedState = state({ contiguousMinSeq: 201, contiguousMaxSeq: 300, oldestLoadedSeq: 201, hasMoreOlder: true });
        const disconnectedPage: MessagePage = {
            messages: Array.from({ length: 100 }, (_, index) => ({
                id: `m${149 - index}`,
                seq: 149 - index,
                localId: null,
                content: { t: 'encrypted', c: `cipher-${149 - index}` },
                createdAt: 1000 + index,
                updatedAt: 1000 + index,
                sentBy: null,
                sentByName: null,
            })),
            minSeq: 50,
            maxSeq: 149,
            hasMoreLocal: true,
        };

        expect(canServeCachedOlderPage(disconnectedPage, cachedState, 100)).toBe(false);
    });

    it('does not move cached oldestLoadedSeq forward while paging through local rows', () => {
        expect(mergeOldestLoadedSeq(state({ oldestLoadedSeq: 1 }), 151)).toBe(1);
        expect(mergeOldestLoadedSeq(state({ oldestLoadedSeq: 151 }), 1)).toBe(1);
        expect(mergeOldestLoadedSeq(state({ oldestLoadedSeq: null, contiguousMinSeq: null }), 151)).toBe(151);
    });

    it('extends coverage only when an older page connects to the known contiguous range', () => {
        const cachedState = state({ contiguousMinSeq: 101, contiguousMaxSeq: 300, oldestLoadedSeq: 101, hasMoreOlder: true, remoteOldestSeq: 1 });
        const patch = buildCoverageStatePatch(cachedState, {
            direction: 'older',
            messages: page(100, { minSeq: 1, maxSeq: 100 }).messages,
            hasMoreOlder: false,
            remoteOldestSeq: 1,
        });

        expect(patch).toMatchObject({
            contiguousMinSeq: 1,
            contiguousMaxSeq: 300,
            oldestLoadedSeq: 1,
            forwardMaxSeq: 300,
            remoteOldestSeq: 1,
            hasMoreOlder: false,
        });
    });

    it('refuses to mark a gapped page as covered', () => {
        const cachedState = state({ contiguousMinSeq: 101, contiguousMaxSeq: 300, oldestLoadedSeq: 101, hasMoreOlder: true, remoteOldestSeq: 1 });
        const gappedMessages = page(100).messages.filter((message) => message.seq !== 51);

        expect(buildCoverageStatePatch(cachedState, {
            direction: 'older',
            messages: gappedMessages,
            hasMoreOlder: true,
        })).toBeNull();
    });
});
