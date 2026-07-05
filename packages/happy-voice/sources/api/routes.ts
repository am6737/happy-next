import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from '../runtime/env';
import { logError, logInfo } from '../runtime/log';
import { sessionStore } from '../runtime/sessionStore';
import { buildRtcToken } from '../runtime/rtcToken';
import { startVoiceChat, stopVoiceChat } from '../runtime/rtcOpenApi';
import { synthesize } from '../runtime/tts';
import { cleanForSpeech } from '../runtime/cleanForSpeech';
import { regexCleanForSpeech } from '../runtime/textClean';
import { renderPrompt } from '../runtime/prompts';
import type { VoiceSessionRecord } from '../types/voice';
import { verifyVoiceAuthToken, type VoiceAuthClaims } from '../runtime/voiceAuth';

function getAuthClaims(request: FastifyRequest): VoiceAuthClaims | null {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
        return verifyVoiceAuthToken(authorization.slice('Bearer '.length).trim(), env.VOICE_AUTH_SECRET);
    }
    return null;
}

function rejectUnauthorized(reply: FastifyReply) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid voice auth token.' });
}

const contextPayloadSchema = z.object({
    version: z.literal(1),
    format: z.literal('happy-app-context-v1'),
    contentType: z.literal('text/plain'),
    text: z.string().min(1),
    createdAt: z.string().min(1),
});

const startSchema = z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1),
    initialContextPayload: contextPayloadSchema.optional(),
    language: z.string().optional(),
    toolBridgeBaseUrl: z.string().optional(),
    welcomeMessage: z.string().max(500).optional(),
    voiceType: z.string().optional(),
    resourceId: z.string().optional(),
    speechRate: z.number().min(-50).max(100).optional(),
});

const stopSchema = z.object({ gatewaySessionId: z.string().uuid() });
const ttsSchema = z.object({
    text: z.string().min(1).max(5000),
    voiceType: z.string().optional(),
    speechRate: z.number().min(-50).max(100).optional(),
});

export function registerRoutes(app: FastifyInstance) {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/healthz', async () => ({ ok: true, service: 'happy-voice' }));

    typed.post('/v1/voice/session/start', {
        schema: {
            body: startSchema,
            response: {
                200: z.object({
                    allowed: z.boolean(),
                    gatewaySessionId: z.string().uuid(),
                    provider: z.literal('volc-rtc'),
                    appId: z.string(),
                    roomId: z.string(),
                    uid: z.string(),
                    agentUid: z.string(),
                    rtcToken: z.string(),
                    expiresAt: z.string(),
                }),
                401: z.object({ error: z.string(), message: z.string() }),
                500: z.object({ error: z.string(), message: z.string() }),
            },
        },
    }, async (request, reply) => {
        const claims = getAuthClaims(request);
        if (!claims) return rejectUnauthorized(reply);
        const body = startSchema.parse(request.body);
        if (body.userId !== claims.userId || (claims.sessionId && body.sessionId !== claims.sessionId)) {
            return rejectUnauthorized(reply);
        }
        const gatewaySessionId = randomUUID();
        const suffix = randomBytes(6).toString('hex');
        const roomId = `happy_voice_${Date.now()}_${suffix}`;
        const uid = `human_${suffix}`;
        const agentUid = `bot_${suffix}`;
        const now = Date.now();
        const expiresAt = new Date(now + env.RTC_TOKEN_TTL_SECONDS * 1000).toISOString();
        const language = body.language || env.DEFAULT_LANGUAGE;
        // Welcome message may hold several '|'-separated options; pick one at random.
        const welcomeRaw = body.welcomeMessage || env.AGENT_WELCOME_MESSAGE;
        const welcomeOptions = welcomeRaw.split('|').map((s) => s.trim()).filter(Boolean);
        const welcomeMessage = welcomeOptions.length > 1
            ? welcomeOptions[Math.floor(Math.random() * welcomeOptions.length)]
            : welcomeRaw.trim();

        const systemPrompt = renderPrompt(env.PROMPT_VOICE_AGENT_FILE, {
            language_preference: language,
            app_session_id: body.sessionId,
        });

        const record: VoiceSessionRecord = {
            gatewaySessionId,
            userId: body.userId,
            appSessionId: body.sessionId,
            roomId,
            taskId: roomId,
            uid,
            agentUid,
            language,
            state: 'starting',
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            expiresAt,
        };
        sessionStore.set(record);

        try {
            const rtcToken = buildRtcToken({
                appId: env.VOLC_RTC_APP_ID,
                appKey: env.VOLC_RTC_APP_KEY,
                roomId,
                userId: uid,
                ttlSeconds: env.RTC_TOKEN_TTL_SECONDS,
            });

            await startVoiceChat({
                roomId,
                taskId: roomId,
                uid,
                agentUid,
                welcomeMessage,
                systemPrompt,
                voiceType: body.voiceType,
                resourceId: body.resourceId,
                speechRate: body.speechRate,
            });

            sessionStore.markState(gatewaySessionId, 'active');
            logInfo('Voice session started', { gatewaySessionId, roomId, userId: body.userId, appSessionId: body.sessionId });

            return reply.send({
                allowed: true,
                gatewaySessionId,
                provider: 'volc-rtc' as const,
                appId: env.VOLC_RTC_APP_ID,
                roomId,
                uid,
                agentUid,
                rtcToken,
                expiresAt,
            });
        } catch (error) {
            sessionStore.markState(gatewaySessionId, 'error', error instanceof Error ? error.message : String(error));
            logError('Failed to start voice session', { error, gatewaySessionId, roomId });
            return reply.code(500).send({
                error: 'start_failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    typed.post('/v1/voice/session/stop', {
        schema: {
            body: stopSchema,
            response: {
                200: z.object({ success: z.boolean() }),
                401: z.object({ error: z.string(), message: z.string() }),
            },
        },
    }, async (request, reply) => {
        if (!getAuthClaims(request)) return rejectUnauthorized(reply);
        const { gatewaySessionId } = stopSchema.parse(request.body);
        const record = sessionStore.get(gatewaySessionId);
        if (!record) return reply.send({ success: true });
        await stopVoiceChat(record.roomId, record.taskId);
        sessionStore.markState(gatewaySessionId, 'stopped');
        return reply.send({ success: true });
    });

    typed.get('/v1/voice/session/:gatewaySessionId/status', {
        schema: {
            params: z.object({ gatewaySessionId: z.string().uuid() }),
            response: {
                200: z.object({ found: z.boolean(), session: z.any().optional() }),
                401: z.object({ error: z.string(), message: z.string() }),
            },
        },
    }, async (request, reply) => {
        if (!getAuthClaims(request)) return rejectUnauthorized(reply);
        const { gatewaySessionId } = z.object({ gatewaySessionId: z.string().uuid() }).parse(request.params);
        const record = sessionStore.get(gatewaySessionId);
        return reply.send({ found: !!record, session: record });
    });

    // One-shot TTS for the app's "read message aloud" feature (useMessageTts).
    typed.post('/v1/voice/tts', {
        schema: {
            body: ttsSchema,
            response: {
                200: z.object({ audioBase64: z.string(), mimeType: z.string() }),
                401: z.object({ error: z.string(), message: z.string() }),
                500: z.object({ error: z.string(), message: z.string() }),
            },
        },
    }, async (request, reply) => {
        if (!getAuthClaims(request)) return rejectUnauthorized(reply);
        const { text, voiceType, speechRate } = ttsSchema.parse(request.body);
        try {
            const result = await synthesize(text, { voiceType, speechRate });
            return reply.send(result);
        } catch (error) {
            logError('TTS synthesis failed', { error, chars: text.length });
            return reply.code(500).send({
                error: 'tts_failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    // Streaming "read message aloud": LLM-clean (streamed) → split into sentences →
    // synthesize each sentence → push as SSE audio chunks so the client can play
    // progressively ("process while playing"). Falls back to regex clean.
    typed.post('/v1/voice/tts/stream', {
        schema: { body: ttsSchema },
    }, async (request, reply) => {
        if (!getAuthClaims(request)) return rejectUnauthorized(reply);
        const { text, voiceType, speechRate } = ttsSchema.parse(request.body);

        reply.hijack();
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        const controller = new AbortController();
        reply.raw.on('close', () => controller.abort());

        let seq = 0;
        const sendSentence = async (raw: string) => {
            const s = raw.trim();
            if (!s || controller.signal.aborted) return;
            try {
                const { audioBase64, mimeType } = await synthesize(s, { voiceType, speechRate });
                if (!reply.raw.writableEnded) {
                    reply.raw.write(`data: ${JSON.stringify({ seq: seq++, text: s, audioBase64, mimeType })}\n\n`);
                }
            } catch (error) {
                logError('TTS sentence failed', { error, preview: s.slice(0, 40) });
            }
        };

        const SENTENCE_BOUNDARY = /[。！？!?；;\n]/;
        const MAX_SENTENCE = 60;
        let buf = '';
        const drain = async (final: boolean) => {
            for (;;) {
                const m = buf.match(SENTENCE_BOUNDARY);
                if (m && m.index !== undefined) {
                    const cut = m.index + 1;
                    await sendSentence(buf.slice(0, cut));
                    buf = buf.slice(cut);
                    continue;
                }
                if (buf.length > MAX_SENTENCE) {
                    await sendSentence(buf.slice(0, MAX_SENTENCE));
                    buf = buf.slice(MAX_SENTENCE);
                    continue;
                }
                break;
            }
            if (final && buf.trim()) {
                await sendSentence(buf);
                buf = '';
            }
        };

        try {
            await cleanForSpeech(text, async (piece) => {
                buf += piece;
                await drain(false);
            }, controller.signal);
            await drain(true);
        } finally {
            if (!reply.raw.writableEnded) {
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            }
        }
    });

    // Clean-only (non-streaming): LLM-clean text for speech, regex fallback.
    // Used by the in-call "announce Happy's reply" path before ExternalTextToSpeech.
    typed.post('/v1/voice/clean', {
        schema: {
            body: ttsSchema,
            response: {
                200: z.object({ text: z.string() }),
                401: z.object({ error: z.string(), message: z.string() }),
            },
        },
    }, async (request, reply) => {
        if (!getAuthClaims(request)) return rejectUnauthorized(reply);
        const { text } = ttsSchema.parse(request.body);
        let out = '';
        const ok = await cleanForSpeech(text, (piece) => { out += piece; });
        const speech = ok ? out.trim() : '';
        return reply.send({ text: speech || regexCleanForSpeech(text) });
    });
}
