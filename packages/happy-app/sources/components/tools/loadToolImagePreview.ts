import type { OpenToolImagePreviewRequest, OpenFilePreviewResponse, FilePreviewChunkResponse } from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';
import { FilePreviewLoadError, loadFilePreview } from '../FilePreview/loadFilePreview';

export class ToolImagePreviewError extends Error {}

export async function loadToolImagePreview(sessionId: string, callId: string, signal: AbortSignal) {
    const loaded = await loadFilePreview({ callId }, {
        open: async (request: OpenToolImagePreviewRequest) => {
            const response = await apiSocket.sessionRPC<OpenFilePreviewResponse, OpenToolImagePreviewRequest>(
                sessionId, 'openToolImagePreview', request,
            );
            if (!response.success && response.error.startsWith('image_')) throw new ToolImagePreviewError(response.error);
            return response;
        },
        chunk: (token, offset) => apiSocket.sessionRPC<FilePreviewChunkResponse, { token: string; offset: number }>(
            sessionId, 'readToolImagePreviewChunk', { token, offset },
        ),
        close: (token) => apiSocket.sessionRPC(sessionId, 'closeToolImagePreview', { token, offset: 0 }),
    }, signal);
    if (loaded.metadata.kind !== 'image' || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(loaded.metadata.mimeType)) {
        throw new FilePreviewLoadError('unavailable');
    }
    return `data:${loaded.metadata.mimeType};base64,${loaded.base64}`;
}
