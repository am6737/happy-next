import { create } from 'zustand';
import { File as FsFile } from 'expo-file-system';
import type { ShareIntent } from 'expo-share-intent';

/** A file handed over by the system share sheet, already copied into the app's own storage. */
export type SharedFile = {
    uri: string;
    name: string;
    mimeType: string;
    size: number | null;
    width: number | null;
    height: number | null;
};

/** What another app shared into this one: text (a link among it) or files, never both. */
export type SharedContent = {
    text: string | null;
    files: SharedFile[];
};

/** Where it goes, picked on the share-target page: a new session or one of the active ones. */
export type ShareTarget = { type: 'new' } | { type: 'session'; sessionId: string };

type SharedContentState = {
    content: SharedContent | null;
    target: ShareTarget | null;
    // The share-target page is on screen, so a share arriving now needs no page opened for it
    pageOpen: boolean;
};

export const useSharedContentStore = create<SharedContentState>(() => ({
    content: null,
    target: null,
    pageOpen: false,
}));

function fileName(uri: string, mimeType: string): string {
    const last = decodeURIComponent(uri.split('?')[0].split('/').pop() ?? '');
    if (last) return last;
    const extension = mimeType.split('/')[1]?.split('+')[0];
    return extension ? `shared.${extension}` : 'shared';
}

export function toSharedContent(intent: ShareIntent): SharedContent | null {
    const files: SharedFile[] = (intent.files ?? []).flatMap((file) => {
        if (!file.path) return [];
        const mimeType = file.mimeType || 'application/octet-stream';
        return [{
            uri: file.path,
            name: file.fileName || fileName(file.path, mimeType),
            mimeType,
            size: file.size ?? null,
            width: file.width ?? null,
            height: file.height ?? null,
        }];
    });
    let text = intent.text?.trim() || null;
    // A page shared from a browser: its title reads better above the bare link
    const title = intent.meta?.title?.trim();
    if (text && title && text === intent.webUrl && title !== text) {
        text = `${title}\n${text}`;
    }
    if (!text && files.length === 0) return null;
    return { text, files };
}

/** Deletes the app's copies of shared files nobody took. */
export function discardSharedFiles(files: SharedFile[]) {
    for (const file of files) {
        try {
            const copy = new FsFile(file.uri);
            if (copy.exists) copy.delete();
        } catch { /* The system clears its caches eventually. */ }
    }
}

export function receiveSharedContent(content: SharedContent) {
    const previous = useSharedContentStore.getState().content;
    if (previous) discardSharedFiles(previous.files);
    useSharedContentStore.setState({ content, target: null });
}

export function sendSharedContentTo(target: ShareTarget) {
    useSharedContentStore.setState({ target });
}

/** Drops what was shared without anywhere to go, the share-target page left without a choice. */
export function dismissSharedContent() {
    const { content, target } = useSharedContentStore.getState();
    if (!content || target) return;
    discardSharedFiles(content.files);
    useSharedContentStore.setState({ content: null });
}

export function setSharePageOpen(pageOpen: boolean) {
    useSharedContentStore.setState({ pageOpen });
}

function sameTarget(a: ShareTarget, b: ShareTarget): boolean {
    return a.type === 'new' ? b.type === 'new' : b.type === 'session' && a.sessionId === b.sessionId;
}

/** Hands over what was shared to the composer it was sent to, once. */
export function takeSharedContent(target: ShareTarget): SharedContent | null {
    const { content, target: sentTo } = useSharedContentStore.getState();
    if (!content || !sentTo || !sameTarget(sentTo, target)) return null;
    useSharedContentStore.setState({ content: null, target: null });
    return content;
}
