import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import { writeAskUserQuestionDraft, type AskUserQuestionDraftMap } from '@/sync/askUserQuestionDraft';
import type { AskUserQuestionDraft } from '@/sync/storageTypes';
import { useAskUserQuestionDraft } from './useAskUserQuestionDraft';

// The store pulls in MMKV, the socket and the whole sync machinery, none of which loads here.
// The stand-in below applies writes through the same pure helper the real action uses, so the
// draft lifecycle under test is the real one.
let drafts: AskUserQuestionDraftMap = {};

vi.mock('react-native', () => ({
    AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            askUserQuestionDrafts: drafts,
            setAskUserQuestionDraft: (sessionId: string, toolKey: string, draft: AskUserQuestionDraft | null) => {
                drafts = writeAskUserQuestionDraft(drafts, sessionId, toolKey, draft);
            },
        }),
    },
}));

let api: ReturnType<typeof useAskUserQuestionDraft> | null = null;

function Harness(props: { sessionId: string | null; toolKey: string | null }) {
    api = useAskUserQuestionDraft(props.sessionId, props.toolKey);
    return null;
}

function render(sessionId: string | null = 'session-1', toolKey: string | null = 'tool-1'): ReturnType<typeof create> {
    let renderer!: ReturnType<typeof create>;
    act(() => {
        renderer = create(React.createElement(Harness, { sessionId, toolKey }));
    });
    return renderer;
}

function stored(): AskUserQuestionDraft | undefined {
    return drafts['session-1']?.['tool-1'];
}

beforeEach(() => {
    drafts = {};
    api = null;
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useAskUserQuestionDraft', () => {
    it('seeds the form from the draft written before the row unmounted', () => {
        drafts = writeAskUserQuestionDraft(drafts, 'session-1', 'tool-1', {
            selections: { 0: [2] },
            otherTexts: { 1: 'typed earlier' },
            updatedAt: Date.now(),
        });

        render();

        expect(api!.selections.get(0)).toEqual(new Set([2]));
        expect(api!.otherTexts.get(1)).toBe('typed earlier');
    });

    it('writes a tick through immediately, so scrolling away cannot lose it', () => {
        render();
        act(() => { api!.toggleOption(0, 1, false); });

        expect(stored()!.selections).toEqual({ 0: [1] });
    });

    it('replaces rather than accumulates a single-select tick', () => {
        render();
        act(() => { api!.toggleOption(0, 1, false); });
        act(() => { api!.toggleOption(0, 3, false); });

        expect(stored()!.selections).toEqual({ 0: [3] });
    });

    it('toggles a multi-select tick off again', () => {
        render();
        act(() => { api!.toggleOption(0, 1, true); });
        act(() => { api!.toggleOption(0, 2, true); });
        expect(stored()!.selections).toEqual({ 0: [1, 2] });

        act(() => { api!.toggleOption(0, 1, true); });
        expect(stored()!.selections).toEqual({ 0: [2] });
    });

    it('debounces typing but still lands it', () => {
        render();
        act(() => { api!.setOtherText(0, 'half'); });
        expect(stored()).toBeUndefined();

        act(() => { api!.setOtherText(0, 'half typed'); });
        expect(stored()).toBeUndefined();

        act(() => { vi.advanceTimersByTime(2000); });
        expect(stored()!.otherTexts).toEqual({ 0: 'half typed' });
    });

    it('flushes text still in the debounce window when the row unmounts', () => {
        const renderer = render();
        act(() => { api!.setOtherText(0, 'mid sentence'); });
        act(() => { renderer.unmount(); });

        expect(stored()!.otherTexts).toEqual({ 0: 'mid sentence' });
    });

    it('records a submit so a row that remounts mid-flight stays submitted', () => {
        const renderer = render();
        act(() => { api!.toggleOption(0, 1, false); });
        act(() => { api!.markSubmitted(); });
        act(() => { renderer.unmount(); });

        render();
        expect(api!.isSubmitted).toBe(true);
    });

    it('hands the form back empty once the draft is cleared with the tool finished', () => {
        const renderer = render();
        act(() => { api!.toggleOption(0, 1, false); });
        act(() => { api!.markSubmitted(); });
        act(() => { api!.clearDraft(); });
        // The unmount flush must not write the finished form back.
        act(() => { renderer.unmount(); });

        expect(stored()).toBeUndefined();

        render();
        expect(api!.isSubmitted).toBe(false);
        expect(api!.selections.size).toBe(0);
    });

    it('drafts nothing when the call has no tool id to file it under', () => {
        const renderer = render('session-1', null);
        act(() => { api!.toggleOption(0, 1, false); });
        act(() => { renderer.unmount(); });

        expect(drafts).toEqual({});
    });
});
