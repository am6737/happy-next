import type { ApiMessage } from '../apiTypes';
import type { MessagePage, SessionMessageCacheState, SessionMessageCacheStatePatch } from './types';

export const MESSAGE_CACHE_INITIAL_STATE: SessionMessageCacheState = {
    forwardMaxSeq: 0,
    oldestLoadedSeq: null,
    hasMoreOlder: true,
    contiguousMinSeq: null,
    contiguousMaxSeq: null,
    remoteOldestSeq: null,
    invalidatedAt: null,
    updatedAt: 0,
};

export type CoverageDirection = 'latest' | 'older' | 'newer';

export type CoverageUpdateInput = {
    direction: CoverageDirection;
    messages: ApiMessage[];
    hasMoreOlder?: boolean;
    remoteOldestSeq?: number | null;
    // The pagination cursor the page was fetched with (before_seq for 'older',
    // after_seq for 'newer'). A cursor proves the page is a consecutive slice
    // of the rows that EXIST on the server, so seq holes inside the page or
    // between the page and the cursor are deleted messages, not missing data
    // (seqs are not dense: server-side batch replaces delete rows while the
    // session seq counter only grows).
    cursorSeq?: number | null;
};

export function toMessagePage(messages: ApiMessage[], hasMoreLocal: boolean): MessagePage {
    let minSeq: number | null = null;
    let maxSeq: number | null = null;
    for (const message of messages) {
        minSeq = minSeq === null ? message.seq : Math.min(minSeq, message.seq);
        maxSeq = maxSeq === null ? message.seq : Math.max(maxSeq, message.seq);
    }
    return { messages, minSeq, maxSeq, hasMoreLocal };
}

export function mergeSessionState(
    existing: SessionMessageCacheState | null,
    patch: SessionMessageCacheStatePatch,
    now: number = Date.now(),
): SessionMessageCacheState {
    const contiguousMinSeq = Object.prototype.hasOwnProperty.call(patch, 'contiguousMinSeq')
        ? patch.contiguousMinSeq ?? null
        : existing?.contiguousMinSeq ?? MESSAGE_CACHE_INITIAL_STATE.contiguousMinSeq;
    const contiguousMaxSeq = Object.prototype.hasOwnProperty.call(patch, 'contiguousMaxSeq')
        ? patch.contiguousMaxSeq ?? null
        : existing?.contiguousMaxSeq ?? MESSAGE_CACHE_INITIAL_STATE.contiguousMaxSeq;
    return {
        forwardMaxSeq: patch.forwardMaxSeq ?? existing?.forwardMaxSeq ?? MESSAGE_CACHE_INITIAL_STATE.forwardMaxSeq,
        oldestLoadedSeq: Object.prototype.hasOwnProperty.call(patch, 'oldestLoadedSeq')
            ? patch.oldestLoadedSeq ?? null
            : existing?.oldestLoadedSeq ?? MESSAGE_CACHE_INITIAL_STATE.oldestLoadedSeq,
        hasMoreOlder: patch.hasMoreOlder ?? existing?.hasMoreOlder ?? MESSAGE_CACHE_INITIAL_STATE.hasMoreOlder,
        contiguousMinSeq,
        contiguousMaxSeq,
        remoteOldestSeq: Object.prototype.hasOwnProperty.call(patch, 'remoteOldestSeq')
            ? patch.remoteOldestSeq ?? null
            : existing?.remoteOldestSeq ?? MESSAGE_CACHE_INITIAL_STATE.remoteOldestSeq,
        invalidatedAt: Object.prototype.hasOwnProperty.call(patch, 'invalidatedAt')
            ? patch.invalidatedAt ?? null
            : existing?.invalidatedAt ?? MESSAGE_CACHE_INITIAL_STATE.invalidatedAt,
        updatedAt: now,
    };
}

export function clampForwardMaxSeq(existing: number | null | undefined, next: number | null | undefined): number {
    return Math.max(existing ?? 0, next ?? 0);
}

export function cachedOlderPageReachesKnownStart(
    cachedState: SessionMessageCacheState | null,
    page: MessagePage,
): boolean {
    return cachedState?.hasMoreOlder === false
        && getKnownContiguousMinSeq(cachedState) !== null
        && page.minSeq === getKnownContiguousMinSeq(cachedState);
}

export function canServeCachedOlderPage(
    page: MessagePage | null,
    cachedState: SessionMessageCacheState | null,
    limit: number,
): boolean {
    if (!page || page.messages.length === 0) {
        return false;
    }
    if (!areMessagesSeqContinuous(page.messages)) {
        return false;
    }
    const knownMinSeq = getKnownContiguousMinSeq(cachedState);
    if (knownMinSeq !== null && page.maxSeq !== null && page.maxSeq < knownMinSeq - 1) {
        return false;
    }
    return page.messages.length >= limit
        || page.hasMoreLocal
        || cachedOlderPageReachesKnownStart(cachedState, page);
}

export function getCachedOlderPageUiHasMore(
    page: MessagePage,
    cachedState: SessionMessageCacheState | null,
): boolean {
    return page.hasMoreLocal || (cachedState?.hasMoreOlder ?? true);
}

export function getKnownContiguousMinSeq(state: SessionMessageCacheState | null): number | null {
    return state?.contiguousMinSeq ?? state?.oldestLoadedSeq ?? null;
}

export function getKnownContiguousMaxSeq(state: SessionMessageCacheState | null): number | null {
    const forwardMaxSeq = state?.forwardMaxSeq ?? 0;
    return state?.contiguousMaxSeq ?? (forwardMaxSeq > 0 ? forwardMaxSeq : null);
}

export function getMessageSeqRange(messages: ApiMessage[]): { minSeq: number; maxSeq: number } | null {
    if (messages.length === 0) {
        return null;
    }
    let minSeq = messages[0].seq;
    let maxSeq = messages[0].seq;
    for (const message of messages) {
        minSeq = Math.min(minSeq, message.seq);
        maxSeq = Math.max(maxSeq, message.seq);
    }
    return { minSeq, maxSeq };
}

export function areMessagesSeqContinuous(messages: ApiMessage[]): boolean {
    const range = getMessageSeqRange(messages);
    if (!range) {
        return true;
    }
    const uniqueSeqs = new Set(messages.map((message) => message.seq));
    return uniqueSeqs.size === messages.length
        && range.maxSeq - range.minSeq + 1 === messages.length;
}

export function areMessageSeqsUnique(messages: ApiMessage[]): boolean {
    const uniqueSeqs = new Set(messages.map((message) => message.seq));
    return uniqueSeqs.size === messages.length;
}

export function isPageInsideKnownCoverage(
    state: SessionMessageCacheState | null,
    page: MessagePage,
): boolean {
    const minSeq = getKnownContiguousMinSeq(state);
    const maxSeq = getKnownContiguousMaxSeq(state);
    // Seq holes inside known coverage are deleted messages (the coverage
    // invariant says every EXISTING row in the span is cached), so no density
    // requirement here — only span containment and per-row uniqueness.
    return minSeq !== null
        && maxSeq !== null
        && page.minSeq !== null
        && page.maxSeq !== null
        && page.minSeq >= minSeq
        && page.maxSeq <= maxSeq
        && areMessageSeqsUnique(page.messages);
}

export function buildCoverageStatePatch(
    existing: SessionMessageCacheState | null,
    input: CoverageUpdateInput,
): SessionMessageCacheStatePatch | null {
    const existingMin = getKnownContiguousMinSeq(existing);
    const existingMax = getKnownContiguousMaxSeq(existing);
    let nextMin = existingMin;
    let nextMax = existingMax;
    let remoteOldestSeq = input.remoteOldestSeq ?? existing?.remoteOldestSeq ?? null;

    // A server-slice page (latest bootstrap, or a cursor-paginated fetch) is a
    // consecutive run of the rows that exist on the server; seq holes inside it
    // are deleted messages, not missing data. Density is only required when
    // neither proof applies (e.g. acked messages applied without a cursor).
    const isServerSlice = input.direction === 'latest' || input.cursorSeq != null;
    if (isServerSlice ? !areMessageSeqsUnique(input.messages) : !areMessagesSeqContinuous(input.messages)) {
        return null;
    }

    const range = getMessageSeqRange(input.messages);
    if (!range) {
        if (input.hasMoreOlder === false && existingMin !== null) {
            remoteOldestSeq = remoteOldestSeq ?? existingMin;
            return {
                forwardMaxSeq: existingMax ?? existing?.forwardMaxSeq ?? 0,
                oldestLoadedSeq: existingMin,
                contiguousMinSeq: existingMin,
                contiguousMaxSeq: existingMax,
                remoteOldestSeq,
                hasMoreOlder: false,
            };
        }
        if (input.hasMoreOlder === false && existingMin === null && existingMax === null) {
            return {
                forwardMaxSeq: 0,
                oldestLoadedSeq: null,
                contiguousMinSeq: null,
                contiguousMaxSeq: null,
                remoteOldestSeq: null,
                hasMoreOlder: false,
            };
        }
        return null;
    }

    if (existingMin === null || existingMax === null) {
        nextMin = range.minSeq;
        nextMax = range.maxSeq;
    } else if (input.direction === 'older') {
        // With a cursor at/above the coverage floor, the page is exactly the
        // next existing rows below the cursor: any seqs between the page's top
        // and the floor are deleted rows, so the page connects regardless of
        // numeric adjacency. Without a cursor, fall back to strict adjacency.
        const connects = input.cursorSeq != null
            ? input.cursorSeq >= existingMin
            : range.maxSeq >= existingMin - 1;
        if (!connects) {
            return null;
        }
        if (range.minSeq > existingMax + 1) {
            return null;
        }
        nextMin = Math.min(existingMin, range.minSeq);
        nextMax = Math.max(existingMax, range.maxSeq);
    } else if (input.direction === 'newer') {
        // Mirror of 'older': a cursor at/below the coverage ceiling proves the
        // page continues the covered span upward across any seq holes.
        const connects = input.cursorSeq != null
            ? input.cursorSeq <= existingMax
            : (range.minSeq <= existingMax + 1 && range.maxSeq >= existingMin - 1);
        if (!connects) {
            return null;
        }
        nextMin = Math.min(existingMin, range.minSeq);
        nextMax = Math.max(existingMax, range.maxSeq);
    } else {
        // Latest-page bootstrap can initialize coverage or extend/overlap either edge, but it must
        // not bridge an actual gap between the known contiguous range and the returned page.
        // (With sparse seqs this can false-positive on a hole right above the coverage ceiling;
        // the bootstrap path repairs that case by clearing the stale cache and retrying clean.)
        if (range.minSeq > existingMax + 1 || range.maxSeq < existingMin - 1) {
            return null;
        }
        nextMin = Math.min(existingMin, range.minSeq);
        nextMax = Math.max(existingMax, range.maxSeq);
    }

    if (input.hasMoreOlder === false) {
        remoteOldestSeq = input.remoteOldestSeq ?? nextMin;
    }

    const hasMoreOlder = input.hasMoreOlder !== undefined
        ? (remoteOldestSeq !== null ? nextMin > remoteOldestSeq : input.hasMoreOlder)
        : existing?.hasMoreOlder ?? true;

    return {
        forwardMaxSeq: nextMax ?? 0,
        oldestLoadedSeq: nextMin,
        contiguousMinSeq: nextMin,
        contiguousMaxSeq: nextMax,
        remoteOldestSeq,
        hasMoreOlder,
    };
}

export function mergeOldestLoadedSeq(
    cachedState: SessionMessageCacheState | null,
    minSeq: number | null,
): number | null {
    if (minSeq === null) {
        return getKnownContiguousMinSeq(cachedState);
    }
    const existingOldestLoadedSeq = getKnownContiguousMinSeq(cachedState);
    return existingOldestLoadedSeq === null
        ? minSeq
        : Math.min(existingOldestLoadedSeq, minSeq);
}
