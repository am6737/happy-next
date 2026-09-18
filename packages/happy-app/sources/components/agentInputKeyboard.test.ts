import { describe, expect, it } from 'vitest';
import { ABORT_ESCAPE_WINDOW_MS, resolveEscapeAbort, shouldSendOnEnter } from './agentInputKeyboard';

describe('shouldSendOnEnter', () => {
    it('returns true when enter-to-send is enabled and text is non-empty', () => {
        expect(shouldSendOnEnter({
            key: 'Enter',
            shiftKey: false,
            enterToSendEnabled: true,
            textSnapshot: 'hello',
            isSending: false,
            isSendDisabled: false,
        })).toBe(true);
    });

    it('returns false while a send is already in progress', () => {
        expect(shouldSendOnEnter({
            key: 'Enter',
            shiftKey: false,
            enterToSendEnabled: true,
            textSnapshot: 'hello',
            isSending: true,
            isSendDisabled: false,
        })).toBe(false);
    });

    it('returns false when send is disabled', () => {
        expect(shouldSendOnEnter({
            key: 'Enter',
            shiftKey: false,
            enterToSendEnabled: true,
            textSnapshot: 'hello',
            isSending: false,
            isSendDisabled: true,
        })).toBe(false);
    });
});

describe('resolveEscapeAbort', () => {
    it('arms instead of aborting on the first Escape', () => {
        expect(resolveEscapeAbort({
            key: 'Escape',
            isBusy: true,
            isAborting: false,
            armedAt: 0,
            now: 10_000,
        })).toBe('arm');
    });

    it('aborts on a second Escape inside the window', () => {
        expect(resolveEscapeAbort({
            key: 'Escape',
            isBusy: true,
            isAborting: false,
            armedAt: 10_000,
            now: 10_000 + ABORT_ESCAPE_WINDOW_MS,
        })).toBe('abort');
    });

    it('re-arms when the second Escape arrives too late', () => {
        expect(resolveEscapeAbort({
            key: 'Escape',
            isBusy: true,
            isAborting: false,
            armedAt: 10_000,
            now: 10_000 + ABORT_ESCAPE_WINDOW_MS + 1,
        })).toBe('arm');
    });

    it('ignores Escape while the agent is idle', () => {
        expect(resolveEscapeAbort({
            key: 'Escape',
            isBusy: false,
            isAborting: false,
            armedAt: 10_000,
            now: 10_100,
        })).toBe('ignore');
    });

    it('ignores Escape while an abort is already in flight', () => {
        expect(resolveEscapeAbort({
            key: 'Escape',
            isBusy: true,
            isAborting: true,
            armedAt: 10_000,
            now: 10_100,
        })).toBe('ignore');
    });

    it('ignores keys other than Escape', () => {
        expect(resolveEscapeAbort({
            key: 'Enter',
            isBusy: true,
            isAborting: false,
            armedAt: 10_000,
            now: 10_100,
        })).toBe('ignore');
    });
});
