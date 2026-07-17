import { randomUUID } from 'node:crypto';
import { env } from './env';

const TTS_URL = 'https://openspeech.bytedance.com/api/v1/tts';

interface VolcTtsResponse {
    code?: number;
    message?: string;
    data?: string; // base64 audio
}

export interface SynthesizeOptions {
    voiceType?: string;
    speechRate?: number;
    signal?: AbortSignal;
}

/** REST TTS uses speed_ratio; app speechRate -50..100 maps linearly to 0.5..2.0. */
export function speechRateToSpeedRatio(rate: number | undefined): number {
    if (!rate) return 1.0;
    const ratio = 1 + rate / 100;
    return Math.min(2.0, Math.max(0.5, ratio));
}

export async function synthesize(
    text: string,
    opts: SynthesizeOptions = {},
): Promise<{ audioBase64: string; mimeType: string }> {
    const body = {
        app: {
            appid: env.VOLC_TTS_APP_ID,
            token: env.VOLC_TTS_TOKEN,
            cluster: env.VOLC_TTS_CLUSTER,
        },
        user: { uid: 'happy-voice' },
        audio: {
            voice_type: opts.voiceType || env.VOLC_TTS_VOICE,
            encoding: 'mp3',
            speed_ratio: speechRateToSpeedRatio(opts.speechRate),
        },
        request: {
            reqid: randomUUID(),
            text,
            operation: 'query',
        },
    };

    const res = await fetch(TTS_URL, {
        method: 'POST',
        signal: opts.signal,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer;${env.VOLC_TTS_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Volcano TTS HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as VolcTtsResponse;
    if (!data.data) {
        throw new Error(`Volcano TTS failed: code=${data.code} message=${data.message}`);
    }
    return { audioBase64: data.data, mimeType: 'audio/mpeg' };
}
