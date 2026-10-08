import { createHash, createPublicKey, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateAuthenticationOptions, generateRegistrationOptions,
    verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { db } from '@/storage/db';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';

const challengeLifetimeMs = 2 * 60_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function pruneExpiredHumanChallenges(accountId?: string) {
    const accountScope = accountId
        ? Prisma.sql`AND "accountId"=${accountId}` : Prisma.empty;
    return db.$executeRaw`
        DELETE FROM "AiWebAuthnChallenge" WHERE id IN (
            SELECT id FROM "AiWebAuthnChallenge"
            WHERE "expiresAt" < clock_timestamp() - interval '24 hours'
              ${accountScope}
            ORDER BY "expiresAt" LIMIT 500
        )`;
}

export function startHumanChallengeRetentionWorker() {
    forever('ai-human-challenge-retention', async () => {
        await pruneExpiredHumanChallenges();
        await delay(60_000, shutdownSignal);
    });
}

function config() {
    const rpID = process.env.AI_WEBAUTHN_RP_ID?.trim().toLowerCase();
    const origin = process.env.AI_WEBAUTHN_ORIGIN?.trim();
    if (!rpID || !origin || !/^[a-z0-9.-]+$/.test(rpID)
        || rpID.startsWith('.') || rpID.endsWith('.')) {
        throw new Error('WebAuthn relying party is not configured');
    }
    const url = new URL(origin);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.origin !== origin || (url.protocol !== 'https:'
        && !(local && url.protocol === 'http:'))
        || (url.hostname !== rpID && !url.hostname.endsWith(`.${rpID}`))) {
        throw new Error('WebAuthn relying party origin is invalid');
    }
    return { rpID, origin, rpName: process.env.AI_WEBAUTHN_RP_NAME?.trim() || 'Happy' };
}

function challengeMatches(storedHash: string, challenge: string): boolean {
    const actual = Buffer.from(digest(challenge), 'hex');
    const expected = Buffer.from(storedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function beginHumanCredentialRegistration(accountId: string) {
    const rp = config();
    const existing = await db.aiHumanCredential.findMany({ where: {
        accountId, status: { in: ['pending', 'trusted'] },
    }, select: { credentialId: true, transports: true } });
    const options = await generateRegistrationOptions({ rpName: rp.rpName,
        rpID: rp.rpID, userName: accountId, userID: Buffer.from(accountId),
        timeout: challengeLifetimeMs, attestationType: 'none',
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
        excludeCredentials: existing.map(row => ({ id: row.credentialId,
            transports: row.transports })) });
    const [{ currentTime }] = await db.$queryRaw<Array<{ currentTime: Date }>>`
        SELECT clock_timestamp() AS "currentTime"`;
    const row = await db.aiWebAuthnChallenge.create({ data: { accountId,
        purpose: 'registration', challengeHash: digest(options.challenge),
        expiresAt: new Date(currentTime.getTime() + challengeLifetimeMs) } });
    return { challengeId: row.id, options };
}

export async function completeHumanCredentialRegistration(input: {
    accountId: string; challengeId: string; response: RegistrationResponseJSON;
}) {
    const rp = config();
    if (JSON.stringify(input.response).length > 131_072) throw new Error('Registration response too large');
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AiWebAuthnChallenge"
            WHERE id=${input.challengeId} AND "accountId"=${input.accountId} FOR UPDATE`;
        const row = await tx.aiWebAuthnChallenge.findFirst({ where: {
            id: input.challengeId, accountId: input.accountId,
            purpose: 'registration', consumedAt: null,
        } });
        const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        if (!row || row.expiresAt <= currentTime) throw new Error('Registration challenge unavailable');
        const verified = await verifyRegistrationResponse({ response: input.response,
            expectedChallenge: value => challengeMatches(row.challengeHash, value),
            expectedOrigin: rp.origin, expectedRPID: rp.rpID,
            requireUserPresence: true, requireUserVerification: true });
        if (!verified.verified || !verified.registrationInfo.userVerified) {
            throw new Error('Registration user verification failed');
        }
        const info = verified.registrationInfo;
        const credential = await tx.aiHumanCredential.create({ data: {
            accountId: input.accountId, credentialId: info.credential.id,
            publicKey: Buffer.from(info.credential.publicKey),
            counter: info.credential.counter,
            transports: info.credential.transports ?? [],
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp, status: 'pending',
        } });
        const [{ currentTime: finalTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        const consumed = await tx.aiWebAuthnChallenge.updateMany({ where: {
            id: row.id, accountId: input.accountId, consumedAt: null,
            expiresAt: { gt: finalTime },
        }, data: { consumedAt: finalTime } });
        if (consumed.count !== 1) throw new Error('Registration challenge consumed');
        await tx.aiHumanCredentialTrustAudit.create({ data: {
            accountId: input.accountId, credentialId: credential.id,
            action: 'registered_pending', actorLabel: 'account_jwt',
            approvalNonce: row.id, evidenceHash: digest(info.credential.id),
        } });
        return { credentialId: credential.id, status: 'pending' as const };
    }, { timeout: 10_000 });
}

export type HumanTrustApproval = { accountId: string; credentialId: string;
    approvalNonce: string; actorLabel: string; evidenceHash: string; expiresAt: string };

export async function trustHumanCredential(input: { accountId: string;
    approval: HumanTrustApproval; signature: string }) {
    const key = process.env.AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI;
    if (!key || input.approval.accountId !== input.accountId) {
        throw new Error('Independent enrollment approval unavailable');
    }
    const expiresAt = new Date(input.approval.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()
        || expiresAt.getTime() > Date.now() + 5 * 60_000) {
        throw new Error('Independent enrollment approval expired');
    }
    const payload = JSON.stringify({ accountId: input.approval.accountId,
        credentialId: input.approval.credentialId,
        approvalNonce: input.approval.approvalNonce,
        actorLabel: input.approval.actorLabel,
        evidenceHash: input.approval.evidenceHash,
        expiresAt: input.approval.expiresAt });
    const approved = verifySignature(null, Buffer.from(payload),
        (() => {
            const publicKey = createPublicKey({ key: Buffer.from(key, 'base64'),
                format: 'der', type: 'spki' });
            if (publicKey.asymmetricKeyType !== 'ed25519') {
                throw new Error('Independent enrollment key must be Ed25519');
            }
            return publicKey;
        })(),
        Buffer.from(input.signature, 'base64url'));
    if (!approved) throw new Error('Independent enrollment approval invalid');
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AiHumanCredential"
            WHERE id=${input.approval.credentialId} AND "accountId"=${input.accountId}
            FOR UPDATE`;
        const row = await tx.aiHumanCredential.findFirst({ where: {
            id: input.approval.credentialId, accountId: input.accountId,
            status: 'pending', revokedAt: null,
        } });
        const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        if (!row || expiresAt <= currentTime) throw new Error('Credential trust unavailable');
        await tx.aiHumanCredentialTrustAudit.create({ data: {
            accountId: input.accountId, credentialId: row.id, action: 'trusted',
            actorLabel: input.approval.actorLabel,
            approvalNonce: input.approval.approvalNonce,
            evidenceHash: input.approval.evidenceHash,
        } });
        await tx.aiHumanCredential.update({ where: { id: row.id },
            data: { status: 'trusted', trustedAt: currentTime } });
        return { credentialId: row.id, status: 'trusted' as const };
    });
}

export async function revokeHumanCredential(accountId: string, credentialId: string) {
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AiHumanCredential"
            WHERE id=${credentialId} AND "accountId"=${accountId} FOR UPDATE`;
        const row = await tx.aiHumanCredential.findFirst({ where: {
            id: credentialId, accountId,
        } });
        if (!row) return null;
        if (row.revokedAt) return { credentialId, status: 'revoked' as const,
            duplicate: true };
        const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
            SELECT clock_timestamp() AS "currentTime"`;
        await tx.aiHumanCredential.update({ where: { id: row.id }, data: {
            status: 'revoked', revokedAt: currentTime,
        } });
        // A revoked device must not leave an outstanding confirmation or drain token usable.
        const recoveries = await tx.aiCapabilityRecoveryRequest.findMany({ where: {
            accountId, status: 'confirmed',
        }, select: { id: true, generation: true } });
        await tx.aiCapabilityRecoveryRequest.updateMany({ where: {
            accountId, status: 'confirmed',
        }, data: { status: 'revoked', requestExpiresAt: currentTime } });
        await tx.aiExecutionCapability.updateMany({ where: {
            accountId, recoveryMode: 'drain', revokedAt: null,
        }, data: { revokedAt: currentTime } });
        await tx.aiCapabilityRecoveryAudit.createMany({ data: recoveries.map(recovery => ({
            recoveryId: recovery.id, generation: recovery.generation,
            action: `credential_revoked:${digest(row.credentialId).slice(0, 16)}`,
            actorAccountId: accountId,
        })), skipDuplicates: true });
        await tx.aiHumanCredentialTrustAudit.create({ data: {
            accountId, credentialId, action: 'revoked', actorLabel: 'account_jwt',
            approvalNonce: randomUUID(), evidenceHash: digest(row.credentialId),
        } });
        return { credentialId, status: 'revoked' as const, duplicate: false };
    });
}

export async function beginHumanRecoveryConfirmation(input: { accountId: string;
    recoveryId: string; generation: number }) {
    const rp = config();
    const row = await db.aiCapabilityRecoveryRequest.findFirst({ where: {
        id: input.recoveryId, accountId: input.accountId,
        generation: input.generation, status: 'pending',
        requestExpiresAt: { gt: new Date() },
    }, select: { id: true } });
    if (!row) throw new Error('Recovery request unavailable');
    const credentials = await db.aiHumanCredential.findMany({ where: {
        accountId: input.accountId, status: 'trusted', revokedAt: null,
    }, select: { credentialId: true, transports: true } });
    if (!credentials.length) throw new Error('Trusted human credential required');
    const options = await generateAuthenticationOptions({ rpID: rp.rpID,
        timeout: challengeLifetimeMs, userVerification: 'required',
        allowCredentials: credentials.map(item => ({ id: item.credentialId,
            transports: item.transports })) });
    const [{ currentTime }] = await db.$queryRaw<Array<{ currentTime: Date }>>`
        SELECT clock_timestamp() AS "currentTime"`;
    const challenge = await db.aiWebAuthnChallenge.create({ data: {
        accountId: input.accountId, purpose: 'recovery_confirm',
        challengeHash: digest(options.challenge), recoveryId: input.recoveryId,
        generation: input.generation, action: 'drain_failed_execution',
        expiresAt: new Date(currentTime.getTime() + challengeLifetimeMs),
    } });
    return { challengeId: challenge.id, options, recoveryId: input.recoveryId,
        generation: input.generation, action: 'drain_failed_execution' as const };
}

export async function verifyHumanRecoveryConfirmationTx(tx: Prisma.TransactionClient,
    input: { accountId: string; recoveryId: string; generation: number;
        challengeId: string; response: AuthenticationResponseJSON }) {
    const rp = config();
    if (JSON.stringify(input.response).length > 65_536) throw new Error('Assertion response too large');
    await tx.$queryRaw`SELECT id FROM "AiWebAuthnChallenge"
        WHERE id=${input.challengeId} AND "accountId"=${input.accountId} FOR UPDATE`;
    const challenge = await tx.aiWebAuthnChallenge.findFirst({ where: {
        id: input.challengeId, accountId: input.accountId,
        purpose: 'recovery_confirm', recoveryId: input.recoveryId,
        generation: input.generation, action: 'drain_failed_execution', consumedAt: null,
    } });
    const [{ currentTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
        SELECT clock_timestamp() AS "currentTime"`;
    if (!challenge || challenge.expiresAt <= currentTime) {
        throw new Error('Human confirmation challenge unavailable');
    }
    const credential = await tx.aiHumanCredential.findFirst({ where: {
        credentialId: input.response.id, accountId: input.accountId,
        status: 'trusted', revokedAt: null,
    } });
    if (!credential) throw new Error('Trusted human credential unavailable');
    await tx.$queryRaw`SELECT id FROM "AiHumanCredential" WHERE id=${credential.id}
        AND "accountId"=${input.accountId} FOR UPDATE`;
    const locked = await tx.aiHumanCredential.findUniqueOrThrow({ where: {
        id: credential.id } });
    if (locked.status !== 'trusted' || locked.revokedAt) {
        throw new Error('Human credential revoked');
    }
    const verified = await verifyAuthenticationResponse({ response: input.response,
        expectedChallenge: value => challengeMatches(challenge.challengeHash, value),
        expectedOrigin: rp.origin, expectedRPID: rp.rpID,
        credential: { id: locked.credentialId,
            publicKey: Uint8Array.from(locked.publicKey),
            counter: locked.counter, transports: locked.transports },
        requireUserVerification: true });
    if (!verified.verified || !verified.authenticationInfo.userVerified) {
        throw new Error('Human user verification failed');
    }
    const [{ currentTime: finalTime }] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
        SELECT clock_timestamp() AS "currentTime"`;
    const consumed = await tx.aiWebAuthnChallenge.updateMany({ where: {
        id: challenge.id, accountId: input.accountId, consumedAt: null,
        expiresAt: { gt: finalTime },
    }, data: { consumedAt: finalTime } });
    if (consumed.count !== 1) throw new Error('Human confirmation challenge consumed');
    await tx.aiHumanCredential.update({ where: { id: locked.id }, data: {
        counter: verified.authenticationInfo.newCounter,
        backedUp: verified.authenticationInfo.credentialBackedUp,
        lastUsedAt: finalTime,
    } });
    return { credentialId: locked.id, credentialHash: digest(locked.credentialId) };
}
