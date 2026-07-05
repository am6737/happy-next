import { z } from 'zod';

// Env is provided by `tsx --env-file=.env.local` in dev and by the container in prod.

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3040),

    // App-facing auth. The API server signs short-lived bearer tokens with this secret.
    VOICE_AUTH_SECRET: z.string().min(32, 'VOICE_AUTH_SECRET must be at least 32 characters'),

    // RTC (audio transport + room join token). Use the "AI agent" type RTC app.
    VOLC_RTC_APP_ID: z.string().min(1, 'VOLC_RTC_APP_ID is required'),
    VOLC_RTC_APP_KEY: z.string().min(1, 'VOLC_RTC_APP_KEY is required'),
    // OpenAPI signing (IAM access key) for StartVoiceChat / StopVoiceChat.
    VOLC_ACCESS_KEY_ID: z.string().min(1, 'VOLC_ACCESS_KEY_ID is required'),
    VOLC_SECRET_ACCESS_KEY: z.string().min(1, 'VOLC_SECRET_ACCESS_KEY is required'),
    VOLC_RTC_REGION: z.string().default('cn-north-1'),
    VOLC_RTC_API_VERSION: z.string().default('2025-06-01'),
    RTC_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

    // ASR (seed bigmodel; auth is bound to the agent RTC app — no separate token).
    VOLC_ASR_RESOURCE_ID: z.string().default('volc.seedasr.sauc.duration'),
    VOLC_ASR_STREAM_MODE: z.coerce.number().int().default(2),
    VOLC_ASR_SILENCE_MS: z.coerce.number().int().positive().default(600),

    // LLM (Doubao via built-in ArkV3 — runs inside Volcano, streaming).
    DOUBAO_MODEL: z.string().default('doubao-seed-2-0-lite-260428'),
    LLM_THINKING_TYPE: z.string().default('disabled'),
    LLM_HISTORY_LENGTH: z.coerce.number().int().positive().default(10),
    LLM_TEMPERATURE: z.coerce.number().default(0.1),
    LLM_TOP_P: z.coerce.number().default(0.3),
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(512),

    // Unified voice/speaker — used by BOTH the live agent TTS and message-playback TTS.
    VOLC_TTS_VOICE: z.string().default('zh_female_vv_uranus_bigtts'),

    // Agent TTS (bidirectional streaming, for the live conversation). seed-tts-2.0 is
    // required for the multilingual bigmodel voices (e.g. zh_female_vv_uranus_bigtts).
    VOLC_AGENT_TTS_RESOURCE_ID: z.string().default('seed-tts-2.0'),

    // Message-playback TTS (one-shot REST, for the app's "read message aloud" feature).
    VOLC_TTS_APP_ID: z.string().min(1, 'VOLC_TTS_APP_ID is required'),
    VOLC_TTS_TOKEN: z.string().min(1, 'VOLC_TTS_TOKEN is required'),
    VOLC_TTS_CLUSTER: z.string().default('volcano_tts'),

    // Message-playback TTS text cleaning (streamed): LLM via Ark, regex fallback.
    ARK_API_KEY: z.string().optional(),
    ARK_BASE_URL: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
    TTS_CLEAN_LLM: z
        .string()
        .optional()
        .transform((v) => {
            if (v === undefined) return true;
            const s = v.trim().toLowerCase();
            return s !== 'false' && s !== '0' && s !== 'off' && s !== '';
        }),
    TTS_CLEAN_MODEL: z.string().default('doubao-seed-2-0-lite-260428'),
    TTS_CLEAN_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    // 纯文本(无代码/URL/表格结构)清洗后长度 ≤ 此值时跳过 LLM,直接念 regex 结果。
    TTS_CLEAN_SKIP_MAX_CHARS: z.coerce.number().int().positive().default(120),

    DEFAULT_LANGUAGE: z.string().default('zh'),
    AGENT_WELCOME_MESSAGE: z.string().default('你好，需要我做点什么？'),

    PROMPT_VOICE_AGENT_FILE: z.string().default('prompts/voice-agent.system.txt'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment for happy-voice');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment for happy-voice');
}

export const env = parsed.data;
