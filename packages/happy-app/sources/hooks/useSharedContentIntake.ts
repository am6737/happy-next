import * as React from 'react';
import { takeSharedContent, useSharedContentStore, type ShareTarget, type SharedFile } from '@/share/sharedContent';

/**
 * Fills a composer with what another app shared, once the share-target page sent it here: the
 * text is added after whatever draft is already there, images go in as images while there is
 * room (the rest, videos and other files as file attachments). Nothing is sent.
 *
 * Only a focused composer takes it, so the one under the share-target page doesn't snatch it
 * before the page has closed. Taking it waits a tick, after the draft has been restored on
 * mount, so the shared text lands after the draft rather than in place of it.
 */
export function useSharedContentIntake({ target, enabled, setText, addImages, addFiles }: {
    target: ShareTarget;
    enabled: boolean;
    setText: (update: (text: string) => string) => void;
    // Takes the images it has room for and returns the rest
    addImages: (files: SharedFile[]) => Promise<SharedFile[]>;
    addFiles: (files: SharedFile[]) => void;
}) {
    const pending = useSharedContentStore((state) => state.content !== null && state.target !== null);
    const targetKey = target.type === 'new' ? 'new' : target.sessionId;
    const latest = React.useRef({ target, setText, addImages, addFiles });
    latest.current = { target, setText, addImages, addFiles };

    React.useEffect(() => {
        if (!enabled || !pending) return;
        const timer = setTimeout(() => {
            const { target, setText, addImages, addFiles } = latest.current;
            const content = takeSharedContent(target);
            if (!content) return;
            const text = content.text;
            if (text) setText((current) => current.trim() ? `${current.replace(/\s+$/, '')}\n${text}` : text);
            const isImage = (file: SharedFile) => file.mimeType.startsWith('image/') && file.mimeType !== 'image/svg+xml';
            const images = content.files.filter(isImage);
            const others = content.files.filter((file) => !isImage(file));
            void (async () => {
                const rest = images.length > 0 ? await addImages(images) : [];
                if (rest.length + others.length > 0) addFiles([...rest, ...others]);
            })();
        }, 0);
        return () => clearTimeout(timer);
    }, [enabled, pending, targetKey]);
}
