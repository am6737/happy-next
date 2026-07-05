import { z } from "zod";
import { Fastify } from "../types";

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
                        baseUrl: z.string().nullable(),
                        publicKey: z.string().nullable(),
                    }).nullable(),
                })
            }
        }
    }, async () => {
        const voiceBaseUrl = optionalEnv('PUBLIC_VOICE_BASE_URL');
        const voicePublicKey = optionalEnv('PUBLIC_VOICE_PUBLIC_KEY');

        return {
            apiBaseUrl: optionalEnv('PUBLIC_API_BASE_URL'),
            voice: voiceBaseUrl || voicePublicKey ? {
                baseUrl: voiceBaseUrl,
                publicKey: voicePublicKey,
            } : null,
        };
    });
}
