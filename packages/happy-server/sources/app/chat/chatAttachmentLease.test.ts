import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    removeObject: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: {
        chatAttachment: {
            findMany: mocks.findMany,
            updateMany: mocks.updateMany,
            deleteMany: mocks.deleteMany,
        },
    },
}));

vi.mock('@/storage/files', () => ({
    s3privateBucket: 'private-bucket',
    s3client: { removeObject: mocks.removeObject },
}));

vi.mock('@/utils/forever', () => ({ forever: vi.fn() }));
vi.mock('@/utils/delay', () => ({ delay: vi.fn() }));
vi.mock('@/utils/shutdown', () => ({ shutdownSignal: new AbortController().signal }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import {
    AttachmentLeaseError,
    cleanupExpiredAttachmentLeases,
    commitAttachmentLeases,
} from './chatAttachmentLease';

describe('attachment leases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateMany.mockResolvedValue({ count: 1 });
        mocks.deleteMany.mockResolvedValue({ count: 1 });
        mocks.removeObject.mockResolvedValue(undefined);
    });

    it('commits only leases owned by the sender and session', async () => {
        const tx = {
            chatAttachment: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'attachment-1',
                    accountId: 'account-1',
                    sessionId: 'session-1',
                    committedAt: null,
                    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
                    messageLocalId: null,
                    cleanupStartedAt: null,
                }]),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
        } as any;

        await commitAttachmentLeases(tx, {
            attachmentIds: ['attachment-1'],
            accountId: 'account-1',
            sessionId: 'session-1',
            messageLocalId: 'local-1',
        });

        expect(tx.chatAttachment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                messageLocalId: 'local-1',
                expiresAt: null,
            }),
        }));

        tx.chatAttachment.findMany.mockResolvedValueOnce([]);
        await expect(commitAttachmentLeases(tx, {
            attachmentIds: ['attachment-2'],
            accountId: 'account-1',
            sessionId: 'session-1',
            messageLocalId: 'local-1',
        })).rejects.toBeInstanceOf(AttachmentLeaseError);
    });

    it('rejects expired leases and cleanup claim races', async () => {
        const tx = {
            chatAttachment: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'attachment-1',
                    accountId: 'account-1',
                    sessionId: 'session-1',
                    committedAt: null,
                    expiresAt: new Date('2000-01-01T00:00:00.000Z'),
                    messageLocalId: null,
                    cleanupStartedAt: null,
                }]),
                updateMany: vi.fn(),
            },
        } as any;

        await expect(commitAttachmentLeases(tx, {
            attachmentIds: ['attachment-1'],
            accountId: 'account-1',
            sessionId: 'session-1',
            messageLocalId: 'local-1',
        })).rejects.toBeInstanceOf(AttachmentLeaseError);
        expect(tx.chatAttachment.updateMany).not.toHaveBeenCalled();

        tx.chatAttachment.findMany.mockResolvedValueOnce([{
            id: 'attachment-1',
            accountId: 'account-1',
            sessionId: 'session-1',
            committedAt: null,
            expiresAt: new Date('2099-01-01T00:00:00.000Z'),
            messageLocalId: null,
            cleanupStartedAt: null,
        }]);
        tx.chatAttachment.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(commitAttachmentLeases(tx, {
            attachmentIds: ['attachment-1'],
            accountId: 'account-1',
            sessionId: 'session-1',
            messageLocalId: 'local-1',
        })).rejects.toBeInstanceOf(AttachmentLeaseError);
    });

    it('claims and deletes expired uncommitted ciphertext', async () => {
        const now = new Date('2026-07-31T00:00:00.000Z');
        mocks.findMany.mockResolvedValue([{ id: 'attachment-1', path: 'opaque/path' }]);

        await expect(cleanupExpiredAttachmentLeases(now)).resolves.toBe(1);

        expect(mocks.removeObject).toHaveBeenCalledWith('private-bucket', 'opaque/path');
        expect(mocks.deleteMany).toHaveBeenCalledWith({
            where: { id: 'attachment-1', committedAt: null, cleanupStartedAt: now },
        });
    });

    it('releases the cleanup claim when object deletion fails', async () => {
        const now = new Date('2026-07-31T00:00:00.000Z');
        mocks.findMany.mockResolvedValue([{ id: 'attachment-1', path: 'opaque/path' }]);
        mocks.removeObject.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(cleanupExpiredAttachmentLeases(now)).resolves.toBe(0);
        expect(mocks.updateMany).toHaveBeenLastCalledWith({
            where: { id: 'attachment-1', committedAt: null, cleanupStartedAt: now },
            data: { cleanupStartedAt: null },
        });
    });
});
