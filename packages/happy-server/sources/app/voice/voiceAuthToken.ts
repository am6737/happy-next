import { createHmac, randomUUID } from "node:crypto";

const TOKEN_TYPE = "happy-voice-token";
const ISSUER = "happy-server";
const AUDIENCE = "happy-voice";

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString("base64url");
}

function optionalEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value ? value : null;
}

export function getPublicVoiceBaseUrl(): string | null {
    return optionalEnv("PUBLIC_VOICE_BASE_URL");
}

export function getVoiceAuthSecret(): string | null {
    return optionalEnv("VOICE_AUTH_SECRET");
}

export function getVoiceTokenTtlSeconds(): number {
    const raw = process.env.VOICE_AUTH_TOKEN_TTL_SECONDS?.trim();
    if (!raw) return 120;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

export function isVoiceConfigured(): boolean {
    return !!getPublicVoiceBaseUrl() && !!getVoiceAuthSecret();
}

export function signVoiceAuthToken(params: {
    userId: string;
    sessionId?: string;
}): { token: string; expiresAt: string } {
    const secret = getVoiceAuthSecret();
    if (!secret) {
        throw new Error("VOICE_AUTH_SECRET is not configured");
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + getVoiceTokenTtlSeconds();
    const header = {
        alg: "HS256",
        typ: "JWT",
    };
    const payload = {
        typ: TOKEN_TYPE,
        iss: ISSUER,
        aud: AUDIENCE,
        sub: params.userId,
        sid: params.sessionId,
        iat: now,
        exp,
        jti: randomUUID(),
    };

    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
    return {
        token: `${signingInput}.${signature}`,
        expiresAt: new Date(exp * 1000).toISOString(),
    };
}
