import { z } from "zod";
import { Fastify } from "../types";
import { getPublicVoiceBaseUrl, isVoiceConfigured } from "@/app/voice/voiceAuthToken";

function optionalEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value ? value : null;
}

export function appConfigRoutes(app: Fastify) {
    app.get('/v1/app-config', {
        schema: {
            response: {
                200: z.object({
                    apiBaseUrl: z.string().nullable(),
                    voice: z.object({
                        baseUrl: z.string(),
                    }).nullable(),
                })
            }
        }
    }, async () => {
        return {
            apiBaseUrl: optionalEnv('PUBLIC_API_BASE_URL'),
            voice: isVoiceConfigured() ? {
                baseUrl: getPublicVoiceBaseUrl()!,
            } : null,
        };
    });
}
