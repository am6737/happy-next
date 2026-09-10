import * as React from 'react';
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { OpenFileDownloadRequest } from 'happy-wire';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sessionOpenFileDownload, sessionReadFileDownloadChunk, sessionCloseFileDownload } from '@/sync/ops';
import { downloadFile, downloadFileName, type DownloadProgress } from './downloadFile';
import { FilePreviewLoadError, type LoadedFilePreview } from './loadFilePreview';

export function useFileDownload(sessionId: string, request: OpenFileDownloadRequest, cached?: LoadedFilePreview | null) {
    const [progress, setProgress] = React.useState<DownloadProgress | null>(null);
    const active = React.useRef<AbortController | null>(null);
    React.useEffect(() => {
        setProgress(null);
        return () => {
            active.current?.abort();
            active.current = null;
        };
    }, [sessionId, request.path, request.repoPath, request.version, request.revision, request.compare]);

    const cancel = React.useCallback(() => {
        active.current?.abort();
        active.current = null;
        setProgress(null);
    }, []);

    const start = React.useCallback(async () => {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setProgress({ received: 0, total: null });
        let file: File | undefined;
        let directory: Directory | undefined;
        let handle: ReturnType<File['open']> | undefined;
        const parts: Uint8Array<ArrayBuffer>[] = [];
        try {
            if (Platform.OS !== 'web' && !(await Sharing.isAvailableAsync()))
                throw new Error('Sharing unavailable');
            const sink = {
                start: (metadata: { path: string }) => {
                    if (Platform.OS !== 'web') {
                        const temporary = new Directory(Paths.cache, `download-${Date.now()}-${Math.random().toString(36).slice(2)}`);
                        temporary.create();
                        directory = temporary;
                        file = new File(directory, downloadFileName(metadata.path));
                        file.create({ overwrite: false });
                        handle = file.open();
                    }
                },
                write: (bytes: Uint8Array<ArrayBuffer>) => {
                    if (handle) handle.writeBytes(bytes);
                    else parts.push(bytes);
                },
            };
            let metadata;
            if (cached) {
                if (controller.signal.aborted) return;
                // Preserve the exact bytes already displayed, even if the working tree has changed.
                metadata = cached.metadata;
                sink.start(metadata);
                sink.write(new Uint8Array(cached.data));
                setProgress({ received: metadata.size, total: metadata.size });
            } else {
                metadata = await downloadFile(request, {
                    open: (input) => sessionOpenFileDownload(sessionId, input),
                    chunk: (token, offset) => sessionReadFileDownloadChunk(sessionId, token, offset),
                    close: (token) => sessionCloseFileDownload(sessionId, token),
                }, controller.signal, sink, (value) => {
                    if (!controller.signal.aborted) setProgress(value);
                });
            }
            handle?.close();
            handle = undefined;
            if (controller.signal.aborted) return;
            if (Platform.OS === 'web') {
                const url = URL.createObjectURL(new Blob(parts, { type: metadata.mimeType }));
                const anchor = document.createElement('a');
                try {
                    anchor.href = url;
                    anchor.download = downloadFileName(metadata.path);
                    document.body.appendChild(anchor);
                    anchor.click();
                } finally {
                    anchor.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
            } else if (file) {
                await Sharing.shareAsync(file.uri, {
                    mimeType: metadata.mimeType,
                    dialogTitle: downloadFileName(metadata.path),
                });
            }
        } catch (error) {
            if (!controller.signal.aborted)
                Modal.alert(t('common.error'), error instanceof FilePreviewLoadError && error.code === 'too_large'
                    ? t('files.preview.downloadTooLarge')
                    : error instanceof FilePreviewLoadError && error.code === 'denied'
                        ? t('files.preview.denied') : t('files.preview.downloadFailed'));
        } finally {
            try { handle?.close(); } catch { /* Cleanup must not mask the transfer error. */ }
            try { if (directory?.exists) directory.delete(); } catch { /* Temporary cache is safe to remove later. */ }
            if (active.current === controller) {
                active.current = null;
                setProgress(null);
            }
        }
    }, [sessionId, request, cached]);

    return { start, cancel, progress, downloading: progress !== null };
}
