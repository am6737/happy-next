import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
    removeObject: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: {
        attachmentObjectDeletion: {
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
    processAttachmentObjectDeletions,
    queueAttachmentObjectDeletions,
} from './attachmentObjectDeletion';

describe('attachment object deletion queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateMany.mockResolvedValue({ count: 1 });
        mocks.deleteMany.mockResolvedValue({ count: 1 });
        mocks.removeObject.mockResolvedValue(undefined);
    });

    it('queues unique paths in the caller transaction', async () => {
        const tx = {
            attachmentObjectDeletion: { createMany: mocks.createMany },
        } as any;
        mocks.createMany.mockResolvedValue({ count: 2 });

        await queueAttachmentObjectDeletions(tx, ['path-1', 'path-1', 'path-2']);

        expect(mocks.createMany).toHaveBeenCalledWith({
            data: [{ path: 'path-1' }, { path: 'path-2' }],
            skipDuplicates: true,
        });
    });

    it('claims an object and removes its queue row after S3 deletion', async () => {
        const now = new Date('2026-08-06T00:00:00.000Z');
        mocks.findMany.mockResolvedValue([{ id: 'deletion-1', path: 'opaque/path', attempts: 0 }]);

        await expect(processAttachmentObjectDeletions(now)).resolves.toBe(1);

        expect(mocks.removeObject).toHaveBeenCalledWith('private-bucket', 'opaque/path');
        expect(mocks.deleteMany).toHaveBeenCalledWith({
            where: { id: 'deletion-1', claimedAt: now },
        });
    });

    it('keeps failed deletions for a later retry', async () => {
        const now = new Date('2026-08-06T00:00:00.000Z');
        mocks.findMany.mockResolvedValue([{ id: 'deletion-1', path: 'opaque/path', attempts: 0 }]);
        mocks.removeObject.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(processAttachmentObjectDeletions(now)).resolves.toBe(0);

        expect(mocks.updateMany).toHaveBeenLastCalledWith({
            where: { id: 'deletion-1', claimedAt: now },
            data: {
                attempts: 1,
                claimedAt: null,
                nextAttemptAt: new Date('2026-08-06T00:02:00.000Z'),
                lastError: 'storage unavailable',
            },
        });
        expect(mocks.deleteMany).not.toHaveBeenCalled();
    });
});
