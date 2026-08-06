import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    class S3Error extends Error {
        code?: string;
    }
    return {
        bucketExists: vi.fn(),
        makeBucket: vi.fn(),
        S3Error,
    };
});

vi.mock('minio', () => ({
    Client: class {
        bucketExists = mocks.bucketExists;
        makeBucket = mocks.makeBucket;
    },
    S3Error: mocks.S3Error,
}));

let loadFiles: () => Promise<void>;

describe('loadFiles', () => {
    beforeAll(async () => {
        vi.stubEnv('S3_HOST', 'localhost');
        vi.stubEnv('S3_BUCKET', 'public-bucket');
        vi.stubEnv('S3_PRIVATE_BUCKET', 'private-bucket');
        vi.stubEnv('S3_PUBLIC_URL', 'http://localhost:9000/public-bucket');
        ({ loadFiles } = await import('./files'));
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('tolerates another replica creating the private bucket concurrently', async () => {
        mocks.bucketExists
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const error = new mocks.S3Error('bucket already exists');
        error.code = 'BucketAlreadyOwnedByYou';
        mocks.makeBucket.mockRejectedValueOnce(error);

        await expect(loadFiles()).resolves.toBeUndefined();
        expect(mocks.makeBucket).toHaveBeenCalledWith('private-bucket', 'us-east-1');
        expect(mocks.bucketExists).toHaveBeenLastCalledWith('private-bucket');
    });

    it('does not suppress unrelated bucket creation failures', async () => {
        mocks.bucketExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const error = new mocks.S3Error('access denied');
        error.code = 'AccessDenied';
        mocks.makeBucket.mockRejectedValueOnce(error);

        await expect(loadFiles()).rejects.toBe(error);
    });
});
