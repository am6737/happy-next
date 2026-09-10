import {
    openFilePreviewRequestSchema,
    filePreviewChunkRequestSchema,
    type OpenFilePreviewRequest,
    type OpenFilePreviewResponse,
    type FilePreviewFailure,
    type FilePreviewKind,
} from './filePreview';

export const FILE_DOWNLOAD_LIMIT = 100 * 1024 * 1024;
export const openFileDownloadRequestSchema = openFilePreviewRequestSchema;
export const fileDownloadChunkRequestSchema = filePreviewChunkRequestSchema;
export type OpenFileDownloadRequest = OpenFilePreviewRequest;
export type OpenFileDownloadResponse = FilePreviewFailure | (
    Omit<Extract<OpenFilePreviewResponse, { success: true }>, 'kind'> & {
        kind: FilePreviewKind | 'file';
    }
);
