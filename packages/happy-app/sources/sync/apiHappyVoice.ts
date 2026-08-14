import { getHappyVoiceGatewayUrl } from './voiceConfig';
import { TokenStorage } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { storage } from './storage';
import { cleanForSpeech } from '@/realtime/happyVoiceProtocol';
import { findVoiceByType } from '@/constants/Voices';
import type { HappyVoiceContextPayload } from '@/realtime/HappyVoiceContextSerializer';

/**
 * Read the user's voice/speech-rate preferences from synced settings and resolve
 * the gateway request fields. When no voice is selected, voiceType/resourceId are
 * left undefined so the gateway falls back to its env defaults. speechRate is
 * omitted when 0 (normal) to preserve default behavior.
 */
function getVoicePrefs(): { voiceType?: string; resourceId?: string; speechRate?: number } {
    const settings = storage.getState().settings;
    const voice = findVoiceByType(settings.voiceAssistantVoice);
    const speechRate = settings.voiceAssistantSpeechRate;
    return {
        voiceType: voice?.voiceType,
        resourceId: voice?.resourceId,
        speechRate: speechRate && speechRate !== 0 ? speechRate : undefined,
    };
}

export interface HappyVoiceStartResponse {
    allowed: boolean;
    gatewaySessionId: string;
    /** 'volc-rtc' for the Volcano Engine gateway. */
    provider: 'volc-rtc';
    /** Volcano RTC application id. */
    appId: string;
    /** RTC room id to join. */
    roomId: string;
    /** Human participant RTC uid. */
    uid: string;
    /** AIGC agent (bot) RTC uid — target for control messages. */
    agentUid: string;
    /** RTC join token (AppId + AppKey). */
    rtcToken: string;
    expiresAt: string;
}

interface VoiceAuthTokenResponse {
    voiceBaseUrl: string;
    token: string;
    expiresAt: string;
}

async function getVoiceAuthToken(sessionId?: string): Promise<VoiceAuthTokenResponse> {
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${getServerUrl()}/v1/voice/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${credentials.token}`,
        },
        body: JSON.stringify(sessionId ? { sessionId } : {}),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get voice token: ${response.status} ${errorText}`);
    }

    return await response.json();
}

function getVoiceGatewayUrlFromAuth(auth: VoiceAuthTokenResponse) {
    const baseUrl = auth.voiceBaseUrl || getHappyVoiceGatewayUrl();
    if (!baseUrl) {
        throw new Error('voiceBaseUrl is not configured');
    }
    return baseUrl.replace(/\/+$/, '');
}

function getVoiceGatewayHeaders(auth: VoiceAuthTokenResponse) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`,
    };
}

export async function startHappyVoiceSession(
    sessionId: string,
    initialContextPayload?: HappyVoiceContextPayload,
    language?: string,
    welcomeMessage?: string,
): Promise<HappyVoiceStartResponse> {
    const userId = storage.getState().profile.id;
    if (!userId) {
        throw new Error('profile.id is missing');
    }

    const toolBridgeBaseUrl = process.env.EXPO_PUBLIC_VOICE_TOOL_BRIDGE_BASE_URL || getServerUrl();
    const voicePrefs = getVoicePrefs();

    const voiceAuth = await getVoiceAuthToken(sessionId);
    const response = await fetch(`${getVoiceGatewayUrlFromAuth(voiceAuth)}/v1/voice/session/start`, {
        method: 'POST',
        headers: getVoiceGatewayHeaders(voiceAuth),
        body: JSON.stringify({
            userId,
            sessionId,
            initialContextPayload,
            language,
            toolBridgeBaseUrl,
            welcomeMessage,
            ...voicePrefs,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start voice session: ${response.status} ${errorText}`);
    }

    return await response.json();
}

export async function stopHappyVoiceSession(gatewaySessionId: string): Promise<void> {
    const voiceAuth = await getVoiceAuthToken();
    const response = await fetch(`${getVoiceGatewayUrlFromAuth(voiceAuth)}/v1/voice/session/stop`, {
        method: 'POST',
        headers: getVoiceGatewayHeaders(voiceAuth),
        body: JSON.stringify({ gatewaySessionId }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to stop voice session: ${response.status} ${errorText}`);
    }
}

// NOTE: mid-session text/context injection now happens client-side over RTC
// control messages (see HappyVoiceSession.web.tsx), so the gateway no longer
// exposes /session/text or /session/context.

export interface HappyVoiceTtsResponse {
    audioBase64: string;
    mimeType: string;
}

export async function synthesizeSpeech(text: string): Promise<HappyVoiceTtsResponse> {
    const { voiceType, speechRate } = getVoicePrefs();
    const voiceAuth = await getVoiceAuthToken();
    const response = await fetch(`${getVoiceGatewayUrlFromAuth(voiceAuth)}/v1/voice/tts`, {
        method: 'POST',
        headers: getVoiceGatewayHeaders(voiceAuth),
        body: JSON.stringify({ text, voiceType, speechRate }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to synthesize speech: ${response.status} ${errorText}`);
    }

    return await response.json();
}

/**
 * Prepare "read message aloud": the gateway LLM-cleans the text and returns a
 * short-lived capability URL serving one chunked audio/mpeg stream (no
 * duration, not seekable, closed at end of synthesis). The URL embeds its own
 * token — players GET it directly with no extra headers.
 */
export async function prepareSpeechStream(text: string, signal?: AbortSignal): Promise<{ url: string }> {
    const { voiceType, speechRate } = getVoicePrefs();
    const voiceAuth = await getVoiceAuthToken();
    const response = await fetch(`${getVoiceGatewayUrlFromAuth(voiceAuth)}/v1/voice/tts/stream/prepare`, {
        method: 'POST',
        headers: getVoiceGatewayHeaders(voiceAuth),
        body: JSON.stringify({ text, voiceType, speechRate }),
        signal,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to prepare speech stream: ${response.status} ${errorText}`);
    }
    const data = (await response.json()) as { streamId: string; url: string; expiresAt: string };
    return { url: data.url };
}

/**
 * LLM-clean text for speech via the gateway (regex fallback). Used by the in-call
 * "announce Happy's reply" path before handing text to ExternalTextToSpeech.
 * Always resolves to speakable text — falls back to client-side regex on any error.
 */
export async function cleanSpeechText(text: string): Promise<string> {
    try {
        const voiceAuth = await getVoiceAuthToken();
        const response = await fetch(`${getVoiceGatewayUrlFromAuth(voiceAuth)}/v1/voice/clean`, {
            method: 'POST',
            headers: getVoiceGatewayHeaders(voiceAuth),
            body: JSON.stringify({ text }),
        });
        if (!response.ok) {
            throw new Error(`Failed to clean speech: ${response.status}`);
        }
        const data = (await response.json()) as { text?: string };
        return (data.text && data.text.trim()) || cleanForSpeech(text);
    } catch {
        return cleanForSpeech(text);
    }
}
