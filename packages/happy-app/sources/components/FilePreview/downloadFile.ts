import {
    FILE_DOWNLOAD_LIMIT,
    FILE_PREVIEW_CHUNK_SIZE,
    type OpenFileDownloadRequest,
    type OpenFileDownloadResponse,
    type FilePreviewChunkResponse,
} from 'happy-wire';
import { FilePreviewLoadError } from './loadFilePreview';

export type DownloadMetadata = Extract<OpenFileDownloadResponse, { success: true }>;
export type DownloadProgress = { received: number; total: number | null };
type DownloadRpc = {
    open: (request: OpenFileDownloadRequest) => Promise<OpenFileDownloadResponse>;
    chunk: (token: string, offset: number) => Promise<FilePreviewChunkResponse>;
    close: (token: string) => Promise<unknown>;
};

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('Aborted'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

// The sink can write directly to a native temporary file; no whole-file Base64 or text is built.
export async function downloadFile(
    request: OpenFileDownloadRequest,
    rpc: DownloadRpc,
    signal: AbortSignal,
    sink: {
        start: (metadata: DownloadMetadata) => void;
        write: (data: Uint8Array<ArrayBuffer>) => void;
    },
    onProgress: (progress: DownloadProgress) => void
): Promise<DownloadMetadata> {
    if (signal.aborted) throw new Error('Aborted');
    let token: string | undefined;
    let closing: Promise<unknown> | undefined;
    const close = () => {
        if (token && !closing) closing = rpc.close(token).catch(() => {});
        return closing;
    };
    const abort = () => { void close(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        const opening = rpc.open(request).then((metadata) => {
            if (metadata.success) token = metadata.token;
            // An open RPC may finish after the user has already left or cancelled.
            if (signal.aborted) void close();
            return metadata;
        });
        const metadata = await abortable(opening, signal);
        if (!metadata.success) throw new FilePreviewLoadError(metadata.code);
        if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > FILE_DOWNLOAD_LIMIT)
            throw new FilePreviewLoadError('too_large');
        sink.start(metadata);
        let offset = 0;
        onProgress({ received: offset, total: metadata.size });
        while (offset < metadata.size) {
            if (signal.aborted) throw new Error('Aborted');
            const chunk = await abortable(rpc.chunk(metadata.token, offset), signal);
            if (!chunk.success) throw new FilePreviewLoadError(chunk.code);
            if (chunk.content.length > Math.ceil(FILE_PREVIEW_CHUNK_SIZE / 3) * 4)
                throw new FilePreviewLoadError('unavailable');
            const binary = atob(chunk.content);
            if (!binary.length || binary.length > FILE_PREVIEW_CHUNK_SIZE ||
                chunk.nextOffset !== offset + binary.length || chunk.nextOffset > metadata.size ||
                chunk.done !== (chunk.nextOffset === metadata.size))
                throw new FilePreviewLoadError('unavailable');
            sink.write(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
            offset = chunk.nextOffset;
            onProgress({ received: offset, total: metadata.size });
        }
        if (signal.aborted) throw new Error('Aborted');
        return metadata;
    } finally {
        signal.removeEventListener('abort', abort);
        const released = close();
        if (!signal.aborted) await released;
    }
}

export function downloadFileName(path: string): string {
    return path.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '_').replace(/^\.+$/, '_') || 'download';
}
