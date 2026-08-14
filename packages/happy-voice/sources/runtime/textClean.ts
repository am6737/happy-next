// Pure, env-free text helpers for TTS cleaning. Kept separate from ark.ts (which
// does network I/O and reads env) so the gate logic is trivially unit-testable.

/** Regex-only TTS cleanup — instant fallback when the LLM is unavailable/skipped. */
export function regexCleanForSpeech(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[*#_>~|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Strip closing-tag lookalikes (`</原文 >`, `</ 原文>`, …) before wrapping source
 * text in <原文>: the LLM matches tags as text, not via a parser, so near-miss
 * variants would still break the "everything inside is data" boundary.
 */
export function stripSourceCloseTags(text: string): string {
    return text.replace(/<\s*\/\s*原文\s*>/g, '');
}

const CODE_FENCE = /```|~~~/;
const INLINE_CODE = /`[^`]+`/;
const URL_RE = /https?:\/\//;
const TABLE_ROW = /\|[^\n]*\|/;

/**
 * Decide whether `raw` needs LLM rewriting for speech, or whether the regex-cleaned
 * `cleaned` result is good enough to speak directly (skipping the LLM round-trip).
 *
 * Structure checks run on RAW text because regexCleanForSpeech strips these markers —
 * checking the cleaned text would never find them. Plain text shorter than `maxChars`
 * skips the LLM; longer plain text stays on the LLM path (conservative).
 */
export function needsLlmClean(raw: string, cleaned: string, maxChars: number): boolean {
    if (CODE_FENCE.test(raw)) return true;
    if (INLINE_CODE.test(raw)) return true;
    if (URL_RE.test(raw)) return true;
    if (TABLE_ROW.test(raw)) return true;
    return cleaned.length > maxChars;
}
