import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
    canAccessPublicShareResource,
    signPublicShareResourceToken,
    verifyPublicShareResourceToken,
    verifyPublicShareResourceRenewalToken,
} from './publicShareResourceToken';

describe('public share resource tokens', () => {
    const originalSecret = process.env.HANDY_MASTER_SECRET;
    const tokenHash = createHash('sha256').update('share-token').digest();

    beforeEach(() => {
        process.env.HANDY_MASTER_SECRET = 'test-secret';
    });

    afterEach(() => {
        process.env.HANDY_MASTER_SECRET = originalSecret;
    });

    it('authorizes only the counted share and raw token for the short lease', () => {
        const now = Date.parse('2026-08-06T00:00:00Z');
        const resourceToken = signPublicShareResourceToken({ shareId: 'share-1', tokenHash, now });

        expect(verifyPublicShareResourceToken({ resourceToken, shareId: 'share-1', tokenHash, now })).toBe(true);
        expect(verifyPublicShareResourceToken({ resourceToken, shareId: 'share-2', tokenHash, now })).toBe(false);
        expect(verifyPublicShareResourceToken({
            resourceToken,
            shareId: 'share-1',
            tokenHash: createHash('sha256').update('rotated-token').digest(),
            now,
        })).toBe(false);
        expect(verifyPublicShareResourceToken({
            resourceToken,
            shareId: 'share-1',
            tokenHash,
            now: now + 16 * 60 * 1000,
        })).toBe(false);
    });

    it('rejects missing and tampered credentials', () => {
        const resourceToken = signPublicShareResourceToken({ shareId: 'share-1', tokenHash });
        expect(verifyPublicShareResourceToken({ resourceToken: undefined, shareId: 'share-1', tokenHash })).toBe(false);
        expect(verifyPublicShareResourceToken({ resourceToken: `${resourceToken}x`, shareId: 'share-1', tokenHash })).toBe(false);
    });

    it('renews only while the authentic credential remains unexpired', () => {
        const now = Date.parse('2026-08-06T00:00:00Z');
        const resourceToken = signPublicShareResourceToken({ shareId: 'share-1', tokenHash, now });
        const expiresAt = now + 15 * 60 * 1000;

        expect(verifyPublicShareResourceRenewalToken({
            resourceToken,
            shareId: 'share-1',
            tokenHash,
            now: expiresAt - 1000,
        })).toBe(true);
        expect(verifyPublicShareResourceRenewalToken({
            resourceToken,
            shareId: 'share-1',
            tokenHash,
            now: expiresAt,
        })).toBe(false);
        expect(verifyPublicShareResourceRenewalToken({
            resourceToken,
            shareId: 'share-2',
            tokenHash,
            now,
        })).toBe(false);
    });

    it('requires a counted entry credential only when maxUses is configured', () => {
        const resourceToken = signPublicShareResourceToken({ shareId: 'share-1', tokenHash });
        expect(canAccessPublicShareResource({
            maxUses: null,
            resourceToken: undefined,
            shareId: 'share-1',
            tokenHash,
        })).toBe(true);
        expect(canAccessPublicShareResource({
            maxUses: 1,
            resourceToken: undefined,
            shareId: 'share-1',
            tokenHash,
        })).toBe(false);
        expect(canAccessPublicShareResource({
            maxUses: 1,
            resourceToken,
            shareId: 'share-1',
            tokenHash,
        })).toBe(true);
    });
});
