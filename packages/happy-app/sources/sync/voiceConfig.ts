import type { AppConfig } from './appConfig';
import type { Settings } from './settings';
import { storage } from './storage';
import { sync } from './sync';
import { getDiscoveredVoiceConfig } from './serverConfig';
export type ActionConfirmationSpeed = 'fast' | 'normal' | 'slow';

// Top-level `import { sync }` is safe here even though config.ts loads voiceConfig at
// module-init time: `sync` is only read inside functions (never during module evaluation),
// so any import cycle resolves cleanly. Matches the existing pattern in profileSync.ts.
function applyVoiceSetting(delta: Partial<Settings>): void {
    sync.applySettings(delta);
}

function settings(): Settings {
    return storage.getState().settings;
}

// ── Happy Voice ─────────────────────────────────────────────────────

export function getHappyVoiceGatewayUrl(): string | undefined {
    return getDiscoveredVoiceConfig().baseUrl;
}

// ── Action Confirmation ──────────────────────────────────────────────

export function getActionConfirmation(): boolean {
    return settings().voiceAssistantActionConfirmation;
}

export function setActionConfirmation(value: boolean): void {
    applyVoiceSetting({ voiceAssistantActionConfirmation: value });
}

const SPEED_SECONDS: Record<ActionConfirmationSpeed, number> = {
    fast: 3,
    normal: 5,
    slow: 8,
};

export function getActionConfirmationSpeed(): ActionConfirmationSpeed {
    return settings().voiceAssistantActionConfirmationSpeed;
}

export function setActionConfirmationSpeed(value: ActionConfirmationSpeed): void {
    applyVoiceSetting({ voiceAssistantActionConfirmationSpeed: value });
}

export function getActionConfirmationSeconds(): number {
    return SPEED_SECONDS[getActionConfirmationSpeed()];
}

// ── Welcome Message ─────────────────────────────────────────────────

// The voice gateway (Volcano seed-tts-2.0) only speaks Chinese and English, so
// default greetings come in just those two — Chinese for zh-Hans/zh-Hant,
// English everywhere else (same locale split as constants/Voices.ts). Multiple
// options per language; one is picked at random per session for variety.
const DEFAULT_WELCOME_ZH = [
    '嗨！',
    '在，说吧。',
    '嗯，你说。',
    '来啦，什么事？',
    '我在呢。',
    '说吧，听着呢。',
    '准备好了，开始吧。',
    '想做点什么？',
];
const DEFAULT_WELCOME_EN = [
    'Hi!',
    'Hey.',
    'Yes?',
    "I'm here.",
    'Go ahead.',
    "What's up?",
    'Ready when you are.',
    'Hi — go ahead.',
];

function isChineseLocale(): boolean {
    // Lazy require to avoid the @/text → @/sync/persistence → … → voiceConfig
    // import cycle (same reason as the require in constants/Voices.ts).
    const { getCurrentLanguage } = require('@/text') as typeof import('@/text');
    return getCurrentLanguage().startsWith('zh');
}

export function getWelcomeMessage(): string | undefined {
    // A user-set custom greeting is spoken verbatim. Otherwise pick a random
    // localized default (Chinese or English) so non-Chinese users no longer
    // hear the gateway's hardcoded Chinese AGENT_WELCOME_MESSAGE env default.
    const custom = settings().voiceAssistantWelcomeMessage;
    if (custom) return custom;
    const list = isChineseLocale() ? DEFAULT_WELCOME_ZH : DEFAULT_WELCOME_EN;
    return list[Math.floor(Math.random() * list.length)];
}

export function setWelcomeMessage(value: string | null): void {
    applyVoiceSetting({ voiceAssistantWelcomeMessage: value && value.trim() ? value.trim() : null });
}

export function hasCustomWelcomeMessage(): boolean {
    return settings().voiceAssistantWelcomeMessage != null;
}

// ── Spoken Phrases ──────────────────────────────────────────────────
// Canned phrases spoken via ExternalTextToSpeech (direct TTS, bypassing the
// LLM — see HappyVoiceSession). Same Chinese/English-only rationale as the
// welcome defaults above: the Volcano voices only speak those two well, so
// other languages would just mispronounce.

/** Prefix spoken before reading Happy's latest reply aloud. */
export function happySaysPhrase(text: string): string {
    return isChineseLocale() ? `Happy 说：${text}` : `Happy says: ${text}`;
}

/** Spoken when Happy requests permission to use a named tool. */
export function happyWantsToolPhrase(tool: string): string {
    return isChineseLocale() ? `Happy 想使用 ${tool}，要允许吗？` : `Happy wants to use ${tool}. Allow it?`;
}

/** Spoken for a generic (tool-less) permission request. */
export function happyNeedsPermissionPhrase(): string {
    return isChineseLocale() ? 'Happy 需要权限，要允许吗？' : 'Happy needs permission. Allow it?';
}

// ── Utilities ───────────────────────────────────────────────────────

export function isUsingCustomVoiceConfig(): boolean {
    return hasCustomWelcomeMessage();
}

export function resetVoiceConfig(): void {
    applyVoiceSetting({
        voiceAssistantWelcomeMessage: null,
    });
}

export function validateUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
        return { valid: false, error: 'URL cannot be empty' };
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}

// ── Init ────────────────────────────────────────────────────────────

/** Called once at startup from config.ts to keep the voice config init hook. */
export function initVoiceConfig(_config: AppConfig): void {
    // Kept as the app-level initialization hook for voice settings.
}
