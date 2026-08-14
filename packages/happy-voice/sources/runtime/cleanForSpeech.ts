import { env } from './env';
import { logError } from './log';
import { streamCleanForSpeech, type CleanMode } from './ark';
import { needsLlmClean, regexCleanForSpeech } from './textClean';

/**
 * Unified TTS-text cleaning. Decides between an instant regex-only result and a
 * streamed LLM rewrite, and falls back to regex on LLM failure/timeout.
 *
 * - `onText` receives streamed deltas on the LLM path, or the full text once on the
 *   regex-only / fallback path.
 * - `externalSignal` aborts the LLM call when the consumer goes away (e.g. the SSE
 *   client disconnects). An internal idle timer (TTS_CLEAN_TIMEOUT_MS) aborts a stalled
 *   LLM independently; it only measures time spent waiting for the next Ark delta —
 *   the clock stops while `onText` runs (downstream TTS synthesis can take longer than
 *   the timeout). A timeout with nothing emitted yet still falls back to regex.
 * - Returns `true` when a complete, usable result was delivered via `onText`; returns
 *   `false` when the LLM failed after already emitting partial deltas (or was aborted
 *   with no usable output). Streaming callers can ignore the return value (their audio
 *   already played); accumulating callers should substitute a full regex clean on `false`.
 */
export async function cleanForSpeech(
    text: string,
    onText: (piece: string) => void | Promise<void>,
    externalSignal?: AbortSignal,
): Promise<boolean> {
    const cleaned = regexCleanForSpeech(text);
    if (!env.TTS_CLEAN_LLM || !env.ARK_API_KEY || !needsLlmClean(text, cleaned, env.TTS_CLEAN_SKIP_MAX_CHARS)) {
        await onText(cleaned);
        return true;
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', onAbort);
    }

    let idle: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), env.TTS_CLEAN_TIMEOUT_MS);
    };

    // Mode is decided here, never by the model; `cleaned.length` proxies speech
    // length. The 12000 clamp keeps lengths that full mode's 16384 max_tokens
    // cannot honestly cover out of full mode, regardless of ops overrides.
    // Deliberate (product decision 2026-07): digest failing before its first
    // delta still falls back to the FULL regex text — content over brevity.
    const digestAt = Math.min(env.TTS_CLEAN_DIGEST_MIN_CHARS, 12000);
    const mode: CleanMode = cleaned.length > digestAt ? 'digest' : 'full';

    let sentAny = false;
    try {
        resetIdle();
        await streamCleanForSpeech(text, async (piece) => {
            if (idle) clearTimeout(idle);
            sentAny = true;
            await onText(piece);
            resetIdle();
        }, controller.signal, mode);
        return true;
    } catch (error) {
        // A client-disconnect abort is expected, not a failure — don't log it as one.
        if (!externalSignal?.aborted) {
            logError('LLM clean failed; regex fallback', { error, chars: text.length });
        }
        if (!sentAny && !externalSignal?.aborted) {
            await onText(cleaned);
            return true;
        }
        return false;
    } finally {
        if (idle) clearTimeout(idle);
        if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
}
