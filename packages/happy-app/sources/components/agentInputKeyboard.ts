import type { SupportedKey } from './MultiTextInput';

interface ShouldSendOnEnterParams {
    key: SupportedKey;
    shiftKey: boolean;
    enterToSendEnabled: boolean;
    textSnapshot: string;
    isSending?: boolean;
    isSendDisabled?: boolean;
}

export function shouldSendOnEnter(params: ShouldSendOnEnterParams): boolean {
    if (!params.enterToSendEnabled) return false;
    if (params.key !== 'Enter' || params.shiftKey) return false;
    if (params.isSending || params.isSendDisabled) return false;
    return params.textSnapshot.trim().length > 0;
}

/** How long the first Escape keeps the abort gesture armed. */
export const ABORT_ESCAPE_WINDOW_MS = 1500;

export type EscapeAbortAction = 'ignore' | 'arm' | 'abort';

interface ResolveEscapeAbortParams {
    key: SupportedKey;
    isBusy: boolean;
    isAborting: boolean;
    /** Timestamp of the previous Escape press, 0 when the gesture is not armed. */
    armedAt: number;
    now: number;
}

/**
 * Escape aborts a running turn only on a deliberate double press: the first press
 * arms the gesture, a second press inside the window confirms it.
 */
export function resolveEscapeAbort(params: ResolveEscapeAbortParams): EscapeAbortAction {
    if (params.key !== 'Escape') return 'ignore';
    if (!params.isBusy || params.isAborting) return 'ignore';
    return params.now - params.armedAt <= ABORT_ESCAPE_WINDOW_MS ? 'abort' : 'arm';
}
