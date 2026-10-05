import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { storage } from '@/sync/storage';
import type { AskUserQuestionDraft } from '@/sync/storageTypes';

/** Same window the composer's drafts use — see useDraft. */
const AUTO_SAVE_INTERVAL = 2000;

export interface AskUserQuestionDraftState {
    selections: Map<number, Set<number>>;
    otherTexts: Map<number, string>;
    isSubmitted: boolean;
}

function emptyState(): AskUserQuestionDraftState {
    return { selections: new Map(), otherTexts: new Map(), isSubmitted: false };
}

/**
 * Keeps an `AskUserQuestion` answer as a draft that outlives the row rendering it.
 *
 * The message list is windowed (web renders only the rows in its virtual window, native uses a
 * default `FlatList`), so a row the user scrolls away from — or one that a `message-syncing`
 * reload re-keys — is unmounted outright, taking any `useState` with it. The draft lives in the
 * store under the CLI's tool id instead, so the answer is still there when the row comes back.
 *
 * One-directional, exactly like useDraft and for the same reason: on mount the draft seeds the
 * form ONCE, and after that edits flow only INTO the draft (debounced for typing, immediate for
 * a tick or a submit). Nothing ever writes back over a live form.
 */
export function useAskUserQuestionDraft(
    sessionId: string | null | undefined,
    toolKey: string | null | undefined
): AskUserQuestionDraftState & {
    toggleOption: (questionIndex: number, optionIndex: number, multiSelect: boolean) => void;
    setOtherText: (questionIndex: number, text: string) => void;
    markSubmitted: () => void;
    clearDraft: () => void;
} {
    // A `useState` initializer runs once per mount, which is precisely when a seeded draft is
    // wanted: the row is being (re)created and has nothing of its own to show.
    const [state, setState] = useState<AskUserQuestionDraftState>(() => toDraftState(readDraft(sessionId, toolKey)));
    // Always the latest value, so a debounced or unmounting flush can't write a stale closure.
    const latestRef = useRef(state);
    latestRef.current = state;
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Set once the draft has been retired (the tool result carries the answers). Without it the
    // unmount flush below would write the finished form straight back into the store.
    const clearedRef = useRef(false);

    const flush = useCallback((value: AskUserQuestionDraftState) => {
        if (!sessionId || !toolKey || clearedRef.current) return;
        storage.getState().setAskUserQuestionDraft(sessionId, toolKey, toDraft(value));
    }, [sessionId, toolKey]);

    const persist = useCallback((value: AskUserQuestionDraftState, immediate: boolean) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        if (immediate) {
            flush(value);
            return;
        }
        saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = null;
            flush(latestRef.current);
        }, AUTO_SAVE_INTERVAL);
    }, [flush]);

    const commit = useCallback((value: AskUserQuestionDraftState, immediate: boolean) => {
        clearedRef.current = false;
        latestRef.current = value;
        setState(value);
        persist(value, immediate);
    }, [persist]);

    // Flush the latest value on unmount. Unlike the composer this is the ordinary path, not an
    // edge case: the row unmounts every time it leaves the list's render window.
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
            flush(latestRef.current);
        };
    }, [flush]);

    // And when the app is backgrounded, in case it never comes back.
    useEffect(() => {
        const handleAppStateChange = (next: AppStateStatus) => {
            if (next === 'background' || next === 'inactive') flush(latestRef.current);
        };
        const subscription = AppState.addEventListener('change', handleAppStateChange);
        return () => { subscription.remove(); };
    }, [flush]);

    const toggleOption = useCallback((questionIndex: number, optionIndex: number, multiSelect: boolean) => {
        const current = latestRef.current;
        const selections = new Map(current.selections);
        const selected = selections.get(questionIndex) ?? new Set<number>();
        let next: Set<number>;
        if (multiSelect) {
            next = new Set(selected);
            if (next.has(optionIndex)) next.delete(optionIndex);
            else next.add(optionIndex);
        } else {
            next = new Set([optionIndex]);
        }
        selections.set(questionIndex, next);
        // A tick is discrete and cheap to lose: write it through instead of debouncing.
        commit({ selections, otherTexts: current.otherTexts, isSubmitted: current.isSubmitted }, true);
    }, [commit]);

    const setOtherText = useCallback((questionIndex: number, text: string) => {
        const current = latestRef.current;
        const otherTexts = new Map(current.otherTexts);
        otherTexts.set(questionIndex, text);
        commit({ selections: current.selections, otherTexts, isSubmitted: current.isSubmitted }, false);
    }, [commit]);

    const markSubmitted = useCallback(() => {
        const current = latestRef.current;
        // Keep the draft until the answers land on the tool result: the submitted branch renders
        // from it, so clearing now would flash the row back to "-" if it remounts in flight.
        commit({ selections: current.selections, otherTexts: current.otherTexts, isSubmitted: true }, true);
    }, [commit]);

    // Drops the stored draft without touching what is on screen — the caller decides when the
    // form's contents stop being true (i.e. when the tool result carries the answers).
    const clearDraft = useCallback(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        clearedRef.current = true;
        if (sessionId && toolKey) {
            storage.getState().setAskUserQuestionDraft(sessionId, toolKey, null);
        }
    }, [sessionId, toolKey]);

    return {
        selections: state.selections,
        otherTexts: state.otherTexts,
        isSubmitted: state.isSubmitted,
        toggleOption,
        setOtherText,
        markSubmitted,
        clearDraft,
    };
}

function readDraft(sessionId: string | null | undefined, toolKey: string | null | undefined): AskUserQuestionDraft | null {
    if (!sessionId || !toolKey) return null;
    return storage.getState().askUserQuestionDrafts[sessionId]?.[toolKey] ?? null;
}

function toDraftState(draft: AskUserQuestionDraft | null): AskUserQuestionDraftState {
    if (!draft) return emptyState();
    const selections = new Map<number, Set<number>>();
    for (const [questionIndex, optionIndices] of Object.entries(draft.selections)) {
        selections.set(Number(questionIndex), new Set(optionIndices));
    }
    const otherTexts = new Map<number, string>();
    for (const [questionIndex, text] of Object.entries(draft.otherTexts)) {
        otherTexts.set(Number(questionIndex), text);
    }
    return { selections, otherTexts, isSubmitted: draft.submitted === true };
}

function toDraft(state: AskUserQuestionDraftState): AskUserQuestionDraft | null {
    const selections: Record<number, number[]> = {};
    state.selections.forEach((optionIndices, questionIndex) => {
        if (optionIndices.size > 0) selections[questionIndex] = Array.from(optionIndices);
    });
    const otherTexts: Record<number, string> = {};
    state.otherTexts.forEach((text, questionIndex) => {
        if (text.trim()) otherTexts[questionIndex] = text;
    });
    const submitted = state.isSubmitted || undefined;
    if (!submitted && Object.keys(selections).length === 0 && Object.keys(otherTexts).length === 0) {
        return null;
    }
    return {
        selections,
        otherTexts,
        ...(submitted ? { submitted: true } : {}),
        updatedAt: Date.now(),
    };
}
