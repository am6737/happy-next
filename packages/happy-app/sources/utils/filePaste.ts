export interface ClipboardFilePasteEventLike {
    defaultPrevented?: boolean;
    preventDefault: () => void;
    clipboardData?: {
        items?: ArrayLike<{
            kind: string;
            getAsFile: () => File | null;
        }> | null;
    } | null;
}

interface HandleFilePasteEventOptions {
    isScreenFocused: boolean;
    /** Returns the files the composer will take; the paste is left alone when it takes none. */
    accept: (files: File[]) => File[];
    onFiles: (files: File[]) => Promise<void> | void;
}

/** Takes the files in a paste (screenshots, files copied in the file manager) for the composer. */
export async function handleFilePasteEvent(
    event: ClipboardFilePasteEventLike,
    options: HandleFilePasteEventOptions,
): Promise<boolean> {
    const { isScreenFocused, accept, onFiles } = options;

    if (!isScreenFocused || event.defaultPrevented) {
        return false;
    }

    const items = event.clipboardData?.items;
    if (!items) {
        return false;
    }

    const pasted: File[] = [];
    for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file) pasted.push(file);
    }

    const files = accept(pasted);
    if (files.length === 0) {
        return false;
    }

    event.preventDefault();
    await onFiles(files);
    return true;
}
