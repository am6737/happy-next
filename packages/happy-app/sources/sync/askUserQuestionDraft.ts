import type { AskUserQuestionDraft } from './storageTypes';

/**
 * AskUserQuestion drafts, keyed `sessionId -> toolKey -> draft`.
 *
 * The rules that matter here are the same ones the composer's drafts follow
 * (`persistence.normalizeDraft` / `storage.setDraft`), for the same reason:
 *   - a draft with nothing ticked, nothing typed and no submit is meaningless, so it
 *     normalizes to "no draft" and an untouched question never persists an entry;
 *   - writing a draft that didn't change returns the SAME map reference, so the store
 *     action can skip both the state copy and the MMKV write.
 *
 * Kept free of MMKV/react-native imports so the rules can be tested directly
 * (see askUserQuestionDraft.test.ts) — the real persistence lives in `persistence.ts`.
 */
export type AskUserQuestionDraftMap = Record<string, Record<string, AskUserQuestionDraft>>;

/**
 * The key a draft is filed under: the CLI's own id for the tool call, which is the permission
 * request id while the question is still pending and the tool call id once it starts running.
 *
 * Deliberately NOT the message id. Message ids are minted by `allocateId()` (reducer.ts) and
 * re-randomized whenever the reducer is recreated — a `message-syncing` reload recreates it and
 * re-keys every row — which is exactly the moment a draft has to survive.
 *
 * Null when the call carries neither id: there is no way to submit such a question either, so
 * nothing is drafted for it.
 */
export function askUserQuestionDraftKey(tool: {
    permission?: { id?: string } | null;
    callId?: string;
} | null | undefined): string | null {
    return tool?.permission?.id || tool?.callId || null;
}

/** Ticked options, dropping empty sets and any key that isn't a question index. */
function compactSelections(selections: Record<number, number[]> | null | undefined): Record<number, number[]> {
    const result: Record<number, number[]> = {};
    for (const [key, value] of Object.entries(selections ?? {})) {
        const index = Number(key);
        if (!Number.isInteger(index) || !Array.isArray(value)) continue;
        const optionIndices = value.filter((optionIndex) => Number.isInteger(optionIndex));
        if (optionIndices.length === 0) continue;
        result[index] = optionIndices;
    }
    return result;
}

/** Typed text, dropping blanks and any key that isn't a question index. */
function compactTexts(otherTexts: Record<number, string> | null | undefined): Record<number, string> {
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(otherTexts ?? {})) {
        const index = Number(key);
        if (!Number.isInteger(index) || typeof value !== 'string' || !value.trim()) continue;
        result[index] = value;
    }
    return result;
}

/** Collapse an empty draft to null and drop the parts of a non-empty one that say nothing. */
export function normalizeAskUserQuestionDraft(
    draft: AskUserQuestionDraft | null | undefined
): AskUserQuestionDraft | null {
    if (!draft) return null;
    const selections = compactSelections(draft.selections);
    const otherTexts = compactTexts(draft.otherTexts);
    const submitted = draft.submitted === true;
    if (!submitted && Object.keys(selections).length === 0 && Object.keys(otherTexts).length === 0) {
        return null;
    }
    return {
        selections,
        otherTexts,
        ...(submitted ? { submitted: true } : {}),
        updatedAt: draft.updatedAt,
    };
}

function sameIndexSet(a: number[] | undefined, b: number[] | undefined): boolean {
    if (!a || !b) return !a && !b;
    if (a.length !== b.length) return false;
    for (const value of a) {
        if (!b.includes(value)) return false;
    }
    return true;
}

/** Equality that ignores `updatedAt`: re-flushing an untouched draft must stay a no-op. */
export function isSameAskUserQuestionDraft(
    a: AskUserQuestionDraft | null,
    b: AskUserQuestionDraft | null
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if ((a.submitted === true) !== (b.submitted === true)) return false;
    const aSelectionKeys = Object.keys(a.selections);
    const bSelectionKeys = Object.keys(b.selections);
    if (aSelectionKeys.length !== bSelectionKeys.length) return false;
    for (const key of aSelectionKeys) {
        if (!sameIndexSet(a.selections[Number(key)], b.selections[Number(key)])) return false;
    }
    const aTextKeys = Object.keys(a.otherTexts);
    const bTextKeys = Object.keys(b.otherTexts);
    if (aTextKeys.length !== bTextKeys.length) return false;
    for (const key of aTextKeys) {
        if (a.otherTexts[Number(key)] !== b.otherTexts[Number(key)]) return false;
    }
    return true;
}

/**
 * Write (or clear, with a null draft) one entry. Returns the SAME map on a no-op, which is what
 * lets the store action bail out before copying state or touching MMKV.
 */
export function writeAskUserQuestionDraft(
    drafts: AskUserQuestionDraftMap,
    sessionId: string | null | undefined,
    toolKey: string | null | undefined,
    draft: AskUserQuestionDraft | null
): AskUserQuestionDraftMap {
    if (!sessionId || !toolKey) return drafts;
    const normalized = normalizeAskUserQuestionDraft(draft);
    const sessionDrafts = drafts[sessionId];
    if (isSameAskUserQuestionDraft(normalized, sessionDrafts?.[toolKey] ?? null)) return drafts;

    const nextSessionDrafts = { ...(sessionDrafts ?? {}) };
    if (normalized === null) {
        delete nextSessionDrafts[toolKey];
    } else {
        nextSessionDrafts[toolKey] = normalized;
    }

    const next = { ...drafts };
    if (Object.keys(nextSessionDrafts).length === 0) {
        delete next[sessionId];
    } else {
        next[sessionId] = nextSessionDrafts;
    }
    return next;
}

/**
 * Drop entries older than `maxAgeMs`. A question that was abandoned (its session deleted, its
 * tool call gone after a reload) leaves nothing behind to clear it, so the map is aged out
 * instead of growing forever. Returns the same map when nothing expired.
 */
export function pruneAskUserQuestionDrafts(
    drafts: AskUserQuestionDraftMap,
    now: number,
    maxAgeMs: number
): AskUserQuestionDraftMap {
    let changed = false;
    const next: AskUserQuestionDraftMap = {};
    for (const [sessionId, sessionDrafts] of Object.entries(drafts)) {
        const kept: Record<string, AskUserQuestionDraft> = {};
        for (const [toolKey, draft] of Object.entries(sessionDrafts)) {
            if (typeof draft?.updatedAt !== 'number' || now - draft.updatedAt > maxAgeMs) {
                changed = true;
                continue;
            }
            kept[toolKey] = draft;
        }
        if (Object.keys(kept).length > 0) {
            next[sessionId] = kept;
        } else {
            changed = true;
        }
    }
    return changed ? next : drafts;
}

/** Parse what was on disk back into a map, discarding anything that isn't a usable draft. */
export function parseAskUserQuestionDrafts(raw: unknown): AskUserQuestionDraftMap {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: AskUserQuestionDraftMap = {};
    for (const [sessionId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const sessionDrafts: Record<string, AskUserQuestionDraft> = {};
        for (const [toolKey, draft] of Object.entries(value as Record<string, unknown>)) {
            const parsed = parseAskUserQuestionDraft(draft);
            if (parsed) sessionDrafts[toolKey] = parsed;
        }
        if (Object.keys(sessionDrafts).length > 0) result[sessionId] = sessionDrafts;
    }
    return result;
}

function parseAskUserQuestionDraft(value: unknown): AskUserQuestionDraft | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as {
        selections?: Record<number, number[]>;
        otherTexts?: Record<number, string>;
        submitted?: boolean;
        updatedAt?: number;
    };
    return normalizeAskUserQuestionDraft({
        selections: raw.selections ?? {},
        otherTexts: raw.otherTexts ?? {},
        submitted: raw.submitted === true,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    });
}
