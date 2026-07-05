import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TYPE = 'happy-voice-token';
const ISSUER = 'happy-server';
const AUDIENCE = 'happy-voice';

export interface VoiceAuthClaims {
    userId: string;
    sessionId?: string;
    expiresAt: number;
    jti: string;
}

function parseJsonPart(part: string): unknown {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function verifyVoiceAuthToken(token: string, secret: string): VoiceAuthClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expected = createHmac('sha256', secret).update(signingInput).digest('base64url');
    const signatureBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) {
        return null;
    }

    let header: unknown;
    let payload: unknown;
    try {
        header = parseJsonPart(encodedHeader);
        payload = parseJsonPart(encodedPayload);
    } catch {
        return null;
    }

    if (!isObject(header) || header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    if (!isObject(payload)) return null;
    if (payload.typ !== TOKEN_TYPE || payload.iss !== ISSUER || payload.aud !== AUDIENCE) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    if (typeof payload.jti !== 'string' || !payload.jti) return null;
    if (payload.sid !== undefined && typeof payload.sid !== 'string') return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    return {
        userId: payload.sub,
        sessionId: payload.sid,
        expiresAt: payload.exp,
        jti: payload.jti,
    };
}
