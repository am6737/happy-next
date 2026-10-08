import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/storage/db';

export type InboundKey = { accountId: string; conversationId: string; clientMessageId: string };
export type InboundClaim = InboundKey & { claimOwner: string };

export async function claimInbound(key: InboundKey, payload: unknown): Promise<
    | { kind: 'claimed'; claim: InboundClaim }
    | { kind: 'completed'; response: unknown }
    | { kind: 'conflict' }
    | { kind: 'processing' }
> {
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const claimOwner = randomUUID();
    const leaseUntil = new Date(Date.now() + 60_000);
    try {
        await db.aiInboundRequest.create({ data: { ...key, payloadHash, claimOwner, leaseUntil } });
        return { kind: 'claimed', claim: { ...key, claimOwner } };
    } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
    }
    const existing = await db.aiInboundRequest.findUnique({ where: {
        accountId_conversationId_clientMessageId: key,
    } });
    if (!existing || existing.payloadHash !== payloadHash) return { kind: 'conflict' };
    if (existing.status === 'completed') return { kind: 'completed', response: existing.response };
    const claimed = await db.aiInboundRequest.updateMany({
        where: { ...key, status: existing.status, claimOwner: existing.claimOwner,
            ...(existing.status === 'processing' ? { leaseUntil: { lt: new Date() } } : {}) },
        data: { status: 'processing', claimOwner, leaseUntil },
    });
    return claimed.count ? { kind: 'claimed', claim: { ...key, claimOwner } } : { kind: 'processing' };
}

export async function failInbound(claim: InboundClaim): Promise<void> {
    await db.aiInboundRequest.updateMany({
        where: { ...claim, status: 'processing' },
        data: { status: 'failed', claimOwner: null, leaseUntil: null },
    });
}
