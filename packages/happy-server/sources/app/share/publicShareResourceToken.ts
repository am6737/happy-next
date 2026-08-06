import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TYPE = 'happy-public-share-resource';
const TOKEN_TTL_SECONDS = 15 * 60;

type ResourceTokenPayload = {
    typ: typeof TOKEN_TYPE;
    shareId: string;
    tokenHash: string;
    exp: number;
};

function verifyResourceToken(input: {
    resourceToken: string | undefined;
    shareId: string;
    tokenHash: Buffer;
    now?: number;
}): boolean {
    if (!input.resourceToken) return false;
    const [encoded, encodedSignature, extra] = input.resourceToken.split('.');
    if (!encoded || !encodedSignature || extra !== undefined) return false;

    try {
        const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
        const expectedSignature = signature(encoded);
        if (suppliedSignature.length !== expectedSignature.length
            || !timingSafeEqual(suppliedSignature, expectedSignature)) {
            return false;
        }

        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<ResourceTokenPayload>;
        const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
        return payload.typ === TOKEN_TYPE
            && payload.shareId === input.shareId
            && payload.tokenHash === input.tokenHash.toString('base64url')
            && typeof payload.exp === 'number'
            && payload.exp > nowSeconds;
    } catch {
        return false;
    }
}

function signingSecret(): string {
    const secret = process.env.HANDY_MASTER_SECRET?.trim();
    if (!secret) throw new Error('HANDY_MASTER_SECRET is not configured');
    return secret;
}

function signature(payload: string): Buffer {
    return createHmac('sha256', signingSecret())
        .update('public-share-resource\0')
        .update(payload)
        .digest();
}

export function signPublicShareResourceToken(input: {
    shareId: string;
    tokenHash: Buffer;
    now?: number;
}): string {
    const now = input.now ?? Date.now();
    const payload: ResourceTokenPayload = {
        typ: TOKEN_TYPE,
        shareId: input.shareId,
        tokenHash: input.tokenHash.toString('base64url'),
        exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${signature(encoded).toString('base64url')}`;
}

export function verifyPublicShareResourceToken(input: {
    resourceToken: string | undefined;
    shareId: string;
    tokenHash: Buffer;
    now?: number;
}): boolean {
    return verifyResourceToken(input);
}

export function verifyPublicShareResourceRenewalToken(input: {
    resourceToken: string | undefined;
    shareId: string;
    tokenHash: Buffer;
    now?: number;
}): boolean {
    return verifyResourceToken(input);
}

export function canAccessPublicShareResource(input: {
    maxUses: number | null;
    resourceToken: string | undefined;
    shareId: string;
    tokenHash: Buffer;
    now?: number;
}): boolean {
    return input.maxUses === null || verifyPublicShareResourceToken(input);
}
