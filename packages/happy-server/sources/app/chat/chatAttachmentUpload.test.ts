import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const mocks = vi.hoisted(() => ({
    putObject: vi.fn(),
    removeObject: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
    createManyDeletions: vi.fn(),
}));

vi.mock('@/utils/randomKey', () => ({
    randomKey: () => 'att_test',
}));

vi.mock('@/storage/files', () => ({
    s3privateBucket: 'private-bucket',
    s3client: {
        putObject: mocks.putObject,
        removeObject: mocks.removeObject,
    },
}));

vi.mock('@/storage/db', () => ({
    db: {
        chatAttachment: {
            create: mocks.create,
            aggregate: mocks.aggregate,
            deleteMany: mocks.deleteMany,
        },
        $transaction: async (callback: (tx: unknown) => unknown) => callback({
            chatAttachment: {
                create: mocks.create,
                aggregate: mocks.aggregate,
                count: mocks.count,
                deleteMany: mocks.deleteMany,
            },
            attachmentObjectDeletion: {
                createMany: mocks.createManyDeletions,
            },
        }),
    },
}));

import { chatAttachmentUpload } from './chatAttachmentUpload';

describe('chatAttachmentUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue({ id: 'attachment-1', size: 16 });
        mocks.aggregate.mockResolvedValue({ _sum: { size: 0 } });
        mocks.count.mockResolvedValue(0);
        mocks.deleteMany.mockResolvedValue({ count: 1 });
        mocks.createManyDeletions.mockResolvedValue({ count: 1 });
        mocks.putObject.mockImplementation(async (_bucket, _path, stream: Readable) => {
            for await (const _chunk of stream) {
                // Consume the stream as the MinIO client does.
            }
        });
        mocks.removeObject.mockResolvedValue(undefined);
    });

    it('stores only opaque encrypted attachment metadata', async () => {
        const result = await chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(16)),
            size: 16,
        });

        expect(mocks.putObject).toHaveBeenCalledWith(
            'private-bucket',
            'users/account-1/chat/session-1/att_test',
            expect.any(Readable),
            16,
            { 'Content-Type': 'application/octet-stream' },
        );
        expect(mocks.create).toHaveBeenCalledWith({
            data: {
                accountId: 'account-1',
                sessionId: 'session-1',
                path: 'users/account-1/chat/session-1/att_test',
                size: 16,
                encryptionVersion: 2,
                expiresAt: expect.any(Date),
            },
        });
        expect(result).toEqual({ v: 2, id: 'attachment-1', ciphertextSize: 16 });
    });

    it('rejects impossible ciphertext and rolls back reservations after storage failures', async () => {
        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(15)),
            size: 15,
        })).rejects.toThrow('Invalid encrypted attachment size');
        expect(mocks.putObject).not.toHaveBeenCalled();

        mocks.putObject.mockRejectedValueOnce(new Error('storage unavailable'));
        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(16)),
            size: 16,
        })).rejects.toThrow('storage unavailable');
        expect(mocks.deleteMany).toHaveBeenCalledWith({
            where: { id: 'attachment-1', committedAt: null },
        });
        expect(mocks.removeObject).toHaveBeenCalledWith(
            'private-bucket',
            'users/account-1/chat/session-1/att_test',
        );
    });

    it('rejects uploads that exceed the account reservation quota', async () => {
        mocks.aggregate
            .mockResolvedValueOnce({ _sum: { size: 5 * 1024 * 1024 * 1024 } })
            .mockResolvedValueOnce({ _sum: { size: 0 } });

        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(16)),
            size: 16,
        })).rejects.toThrow('Account attachment storage quota exceeded');
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.putObject).not.toHaveBeenCalled();
    });

    it('rejects uploads when the uncommitted attachment limit is reached', async () => {
        mocks.count
            .mockResolvedValueOnce(100)
            .mockResolvedValueOnce(0);

        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(16)),
            size: 16,
        })).rejects.toThrow('Account uncommitted attachment limit exceeded');
        expect(mocks.count).toHaveBeenCalledWith({
            where: { accountId: 'account-1', committedAt: null },
        });
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.putObject).not.toHaveBeenCalled();
    });

    it('rolls back when the streamed ciphertext does not match its declared size', async () => {
        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(17)),
            size: 16,
        })).rejects.toThrow('Encrypted attachment exceeds declared size');

        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(16)),
            size: 17,
        })).rejects.toThrow('Encrypted attachment size mismatch');

        expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
        expect(mocks.removeObject).toHaveBeenCalledTimes(2);
    });

    it('rejects a multipart stream truncated at the global size limit', async () => {
        const stream = Readable.from(Buffer.alloc(16)) as Readable & { truncated?: boolean };
        stream.truncated = true;

        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream,
            size: 16,
        })).rejects.toThrow('Encrypted attachment exceeds size limit');

        expect(mocks.deleteMany).toHaveBeenCalledOnce();
        expect(mocks.removeObject).toHaveBeenCalledOnce();
    });

    it('queues object deletion when immediate cleanup fails', async () => {
        mocks.putObject.mockImplementationOnce(async (_bucket, _path, stream: Readable) => {
            for await (const _chunk of stream) {
                // Consume the stream before reporting a post-upload failure.
            }
            throw new Error('upload response lost');
        });
        mocks.removeObject.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(chatAttachmentUpload({
            accountId: 'account-1',
            sessionId: 'session-1',
            stream: Readable.from(Buffer.alloc(16)),
            size: 16,
        })).rejects.toThrow('upload response lost');

        expect(mocks.createManyDeletions).toHaveBeenCalledWith({
            data: [{ path: 'users/account-1/chat/session-1/att_test' }],
            skipDuplicates: true,
        });
        expect(mocks.deleteMany).toHaveBeenCalledWith({
            where: { id: 'attachment-1', committedAt: null },
        });
    });
});
