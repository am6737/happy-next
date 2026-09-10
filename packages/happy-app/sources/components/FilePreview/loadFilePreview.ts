import {
    FILE_PREVIEW_BINARY_LIMIT,
    FILE_PREVIEW_TEXT_LIMIT,
    FILE_PREVIEW_CHUNK_SIZE,
    type OpenFilePreviewRequest,
    type OpenFilePreviewResponse,
    type FilePreviewChunkResponse,
    type FilePreviewErrorCode,
} from 'happy-wire';

export class FilePreviewLoadError extends Error {
    constructor(public code: FilePreviewErrorCode) {
        super(code);
    }
}

type Rpc = {
    open: (request: OpenFilePreviewRequest) => Promise<OpenFilePreviewResponse>;
    chunk: (token: string, offset: number) => Promise<FilePreviewChunkResponse>;
    close: (token: string) => Promise<unknown>;
};

export async function loadFilePreview(
    request: OpenFilePreviewRequest,
    rpc: Rpc,
    signal: AbortSignal
) {
    const metadata = await rpc.open(request);
    if (!metadata.success) throw new FilePreviewLoadError(metadata.code);
    try {
        const limit =
            metadata.kind === 'pdf' || metadata.kind === 'image'
                ? FILE_PREVIEW_BINARY_LIMIT
                : FILE_PREVIEW_TEXT_LIMIT;
        if (
            !Number.isSafeInteger(metadata.size) ||
            metadata.size < 0 ||
            metadata.size > limit
        )
            throw new FilePreviewLoadError('too_large');
        const data = new Uint8Array(metadata.size);
        const base64: string[] = [];
        let offset = 0;
        while (offset < metadata.size) {
            if (signal.aborted) throw new Error('Aborted');
            const chunk = await rpc.chunk(metadata.token, offset);
            if (!chunk.success) throw new FilePreviewLoadError(chunk.code);
            if (
                chunk.content.length >
                Math.ceil(FILE_PREVIEW_CHUNK_SIZE / 3) * 4
            )
                throw new FilePreviewLoadError('unavailable');
            const binary = atob(chunk.content);
            if (
                !binary.length ||
                chunk.nextOffset !== offset + binary.length ||
                chunk.nextOffset > metadata.size ||
                chunk.done !== (chunk.nextOffset === metadata.size)
            )
                throw new FilePreviewLoadError('unavailable');
            // Chunks are multiples of three bytes, so their Base64 can be joined without padding in the middle.
            if (!chunk.done && binary.length % 3 !== 0)
                throw new FilePreviewLoadError('unavailable');
            for (let i = 0; i < binary.length; i++)
                data[offset + i] = binary.charCodeAt(i);
            base64.push(chunk.content);
            offset = chunk.nextOffset;
        }
        if (signal.aborted) throw new Error('Aborted');
        const text =
            metadata.kind === 'pdf' || metadata.kind === 'image'
                ? null
                : new TextDecoder('utf-8', { fatal: true }).decode(data);
        return { metadata, data, base64: base64.join(''), text };
    } finally {
        await rpc.close(metadata.token).catch(() => {});
    }
}

export type LoadedFilePreview = Awaited<ReturnType<typeof loadFilePreview>>;

export function selectPreviewMode(
    preferred: string | undefined,
    hasDiff: boolean,
    hasText: boolean,
    compare: boolean
): 'preview' | 'file' | 'diff' {
    if (preferred === 'file' && hasText) return 'file';
    if (preferred === 'preview') return 'preview';
    return hasText && hasDiff && compare ? 'diff' : 'preview';
}
