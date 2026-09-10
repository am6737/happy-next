import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
    FILE_PREVIEW_BINARY_LIMIT,
    FILE_PREVIEW_CHUNK_SIZE,
    filePreviewChunkRequestSchema,
    openToolImagePreviewRequestSchema,
    type FilePreviewFailure,
    type FilePreviewChunkResponse,
    type OpenFilePreviewResponse,
} from 'happy-wire';
import { getToolImageRecord } from './toolImageStore';

function failure(code: FilePreviewFailure['code'], error: string): FilePreviewFailure {
    return { success: false, code, error };
}

// Use file signatures, not extensions, so a renamed text file cannot be served as an image.
function imageMime(data: Buffer): string | null {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'image/gif';
    if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return null;
}

export function createToolImagePreviewHandlers(sessionId?: string) {
    const snapshots = new Map<string, { data: Buffer; timer: ReturnType<typeof setTimeout> }>();
    let opening = false;
    function release(token: string) {
        const snapshot = snapshots.get(token);
        if (snapshot) clearTimeout(snapshot.timer);
        snapshots.delete(token);
    }

    return {
        async open(input: unknown): Promise<OpenFilePreviewResponse> {
            const parsed = openToolImagePreviewRequestSchema.safeParse(input);
            if (!parsed.success || !sessionId) return failure('denied', 'Invalid image preview request');
            const record = getToolImageRecord(sessionId, parsed.data.callId);
            if (!record) return failure('denied', 'image_not_registered');
            if (opening) return failure('unavailable', 'Another image is loading; retry');
            opening = true;
            try {
                if (await realpath(record.path) !== record.realPath) return failure('denied', 'image_changed');
                const handle = await open(record.realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                let data: Buffer;
                try {
                    const info = await handle.stat();
                    if (!info.isFile() || info.dev !== record.dev || info.ino !== record.ino) {
                        return failure('denied', 'image_changed');
                    }
                    if (info.size > FILE_PREVIEW_BINARY_LIMIT) return failure('too_large', 'Image exceeds 20 MiB');
                    const buffer = Buffer.alloc(info.size + 1);
                    let offset = 0;
                    while (offset < buffer.length) {
                        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
                        if (!bytesRead) break;
                        offset += bytesRead;
                    }
                    const after = await handle.stat();
                    if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
                        return failure('unavailable', 'Image changed while being read; retry');
                    }
                    data = buffer.subarray(0, offset);
                } finally {
                    await handle.close();
                }
                const mimeType = imageMime(data);
                if (!mimeType) return failure('unavailable', 'image_unsupported');
                // At most two 20 MiB snapshots per session; abandoned transfers expire automatically.
                while (snapshots.size >= 2) release(snapshots.keys().next().value!);
                const token = randomUUID();
                const timer = setTimeout(() => release(token), 120_000);
                timer.unref();
                snapshots.set(token, { data, timer });
                return {
                    success: true, token, size: data.length, kind: 'image', mimeType,
                    path: record.path, version: 'worktree', deleted: false,
                    diff: '', diffUnavailable: false, changed: false,
                };
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === 'ENOENT' || code === 'ENOTDIR') return failure('unavailable', 'image_missing');
                return failure(code === 'EACCES' || code === 'EPERM' || code === 'ELOOP' ? 'denied' : 'unavailable', 'Cannot read the image');
            } finally {
                opening = false;
            }
        },
        async chunk(input: unknown): Promise<FilePreviewChunkResponse> {
            const parsed = filePreviewChunkRequestSchema.safeParse(input);
            if (!parsed.success) return failure('denied', 'Invalid chunk request');
            const { token, offset } = parsed.data;
            const snapshot = snapshots.get(token);
            if (!snapshot) return failure('expired', 'Image preview expired');
            if (offset > snapshot.data.length) return failure('denied', 'Invalid chunk offset');
            snapshot.timer.refresh();
            const end = Math.min(offset + FILE_PREVIEW_CHUNK_SIZE, snapshot.data.length);
            return { success: true, content: snapshot.data.subarray(offset, end).toString('base64'), nextOffset: end, done: end === snapshot.data.length };
        },
        async close(input: unknown) {
            const parsed = filePreviewChunkRequestSchema.safeParse(input);
            if (parsed.success) release(parsed.data.token);
            return { success: parsed.success };
        },
    };
}
