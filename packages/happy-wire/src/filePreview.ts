import { z } from 'zod';

export const FILE_PREVIEW_TEXT_LIMIT = 2 * 1024 * 1024;
export const FILE_PREVIEW_BINARY_LIMIT = 20 * 1024 * 1024;
export const FILE_PREVIEW_CHUNK_SIZE = 192 * 1024;

export const filePreviewKindSchema = z.enum([
    'svg',
    'html',
    'markdown',
    'pdf',
    'image',
]);
export type FilePreviewKind = z.infer<typeof filePreviewKindSchema>;

export const openFilePreviewRequestSchema = z.object({
    path: z.string().min(1).max(4096),
    repoPath: z.string().min(1).max(4096),
    version: z.enum(['worktree', 'index', 'commit']),
    revision: z.string().min(1).max(256).optional(),
    compare: z.boolean(),
});
export type OpenFilePreviewRequest = z.infer<
    typeof openFilePreviewRequestSchema
>;

export const filePreviewChunkRequestSchema = z.object({
    token: z.string().uuid(),
    offset: z.number().int().nonnegative(),
});
export type FilePreviewChunkRequest = z.infer<
    typeof filePreviewChunkRequestSchema
>;

export type FilePreviewErrorCode =
    'unavailable' | 'too_large' | 'denied' | 'expired';
export type FilePreviewFailure = {
    success: false;
    code: FilePreviewErrorCode;
    error: string;
};
export type OpenFilePreviewResponse =
    | FilePreviewFailure
    | {
          success: true;
          token: string;
          size: number;
          kind: FilePreviewKind;
          mimeType: string;
          version: 'worktree' | 'index' | 'commit';
          revision?: string;
          deleted: boolean;
          path: string;
          diff: string;
          diffUnavailable: boolean;
          changed: boolean;
      };
export type FilePreviewChunkResponse =
    | FilePreviewFailure
    | {
          success: true;
          content: string;
          nextOffset: number;
          done: boolean;
      };

const previewTypes: Record<
    string,
    { kind: FilePreviewKind; mimeType: string }
> = {
    svg: { kind: 'svg', mimeType: 'image/svg+xml' },
    html: { kind: 'html', mimeType: 'text/html' },
    htm: { kind: 'html', mimeType: 'text/html' },
    md: { kind: 'markdown', mimeType: 'text/markdown' },
    markdown: { kind: 'markdown', mimeType: 'text/markdown' },
    pdf: { kind: 'pdf', mimeType: 'application/pdf' },
    png: { kind: 'image', mimeType: 'image/png' },
    jpg: { kind: 'image', mimeType: 'image/jpeg' },
    jpeg: { kind: 'image', mimeType: 'image/jpeg' },
    gif: { kind: 'image', mimeType: 'image/gif' },
    webp: { kind: 'image', mimeType: 'image/webp' },
};

export function getFilePreviewType(path: string) {
    const name = path.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    const extension = name.slice(dot + 1).toLowerCase();
    return dot < 0 || !Object.hasOwn(previewTypes, extension)
        ? null
        : previewTypes[extension];
}
