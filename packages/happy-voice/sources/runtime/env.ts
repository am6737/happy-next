import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3040),
    // Shared with happy-server as voiceBaseUrl; empty means derive from forwarded request headers.
    PUBLIC_VOICE_BASE_URL: z.preprocess(
        (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
        z.string().url().optional(),
    ),

    VOICE_AUTH_SECRET: z.string().min(32, 'VOICE_AUTH_SECRET must be at least 32 characters'),

    VOLC_RTC_APP_ID: z.string().min(1, 'VOLC_RTC_APP_ID is required'),
    VOLC_RTC_APP_KEY: z.string().min(1, 'VOLC_RTC_APP_KEY is required'),
    VOLC_ACCESS_KEY_ID: z.string().min(1, 'VOLC_ACCESS_KEY_ID is required'),
    VOLC_SECRET_ACCESS_KEY: z.string().min(1, 'VOLC_SECRET_ACCESS_KEY is required'),
    VOLC_RTC_REGION: z.string().default('cn-north-1'),
    VOLC_RTC_API_VERSION: z.string().default('2025-06-01'),
    RTC_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

    VOLC_ASR_RESOURCE_ID: z.string().default('volc.seedasr.sauc.duration'),
    VOLC_ASR_STREAM_MODE: z.coerce.number().int().default(2),
    VOLC_ASR_SILENCE_MS: z.coerce.number().int().positive().default(600),

    DOUBAO_MODEL: z.string().default('doubao-seed-2-0-lite-260428'),
    LLM_THINKING_TYPE: z.string().default('disabled'),
    LLM_HISTORY_LENGTH: z.coerce.number().int().positive().default(10),
    LLM_TEMPERATURE: z.coerce.number().default(0.1),
    LLM_TOP_P: z.coerce.number().default(0.3),
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(512),

    VOLC_TTS_VOICE: z.string().default('zh_female_vv_uranus_bigtts'),

    // seed-tts-2.0 is required for multilingual bigmodel voices such as uranus.
    VOLC_AGENT_TTS_RESOURCE_ID: z.string().default('seed-tts-2.0'),

    VOLC_TTS_APP_ID: z.string().min(1, 'VOLC_TTS_APP_ID is required'),
    VOLC_TTS_TOKEN: z.string().min(1, 'VOLC_TTS_TOKEN is required'),
    VOLC_TTS_CLUSTER: z.string().default('volcano_tts'),
    TTS_BIDI_ENABLED: z
        .string()
        .optional()
        .transform((v) => {
            if (v === undefined) return true;
            const s = v.trim().toLowerCase();
            if (!s) return true;
            return s !== 'false' && s !== '0' && s !== 'off';
        }),
    VOLC_TTS_BIDI_RESOURCE_ID: z.string().default('seed-tts-2.0'),

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
    // regex 清洗后长度 > 此值时切"重点转述"模式(全读约超 10 分钟),只播要点并先声明。
    // 生效上限 12000(受清洗 max_tokens 封顶约束,超出按 12000 处理)。
    TTS_CLEAN_DIGEST_MIN_CHARS: z.coerce.number().int().positive().default(3000),

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
