import { describe, expect, it } from 'vitest';
import { FILE_DOWNLOAD_LIMIT, openFileDownloadRequestSchema, fileDownloadChunkRequestSchema } from './fileDownload';

describe('file download contract', () => {
    it('permits unknown extensions but retains version and chunk validation', () => {
        expect(FILE_DOWNLOAD_LIMIT).toBe(104857600);
        expect(openFileDownloadRequestSchema.safeParse({ path: 'file.bin', repoPath: '.', version: 'worktree', compare: false }).success).toBe(true);
        expect(openFileDownloadRequestSchema.safeParse({ path: 'file.bin', repoPath: '.', version: 'invalid', compare: false }).success).toBe(false);
        expect(fileDownloadChunkRequestSchema.safeParse({ token: 'invalid', offset: -1 }).success).toBe(false);
    });
});
