export function isFileDrag(dataTransfer: Pick<DataTransfer, 'types'> | null): boolean {
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types).includes('Files');
}

export function getDroppedFiles(dataTransfer: Pick<DataTransfer, 'files'> | null): File[] {
    if (!dataTransfer) return [];
    return Array.from(dataTransfer.files);
}

interface SplitComposerFilesOptions {
    /** Image types the composer attaches as images; other images go as files. */
    imageTypes: readonly string[];
    supportsImages: boolean;
    canAttachFiles: boolean;
}

/**
 * Sorts files dropped or pasted into the composer: images the AI can see go as images, everything
 * else is uploaded to the machine as a file. What fits neither is left out.
 */
export function splitComposerFiles(files: File[], options: SplitComposerFilesOptions): { images: File[]; files: File[] } {
    const images: File[] = [];
    const others: File[] = [];
    for (const file of files) {
        if (options.supportsImages && options.imageTypes.includes(file.type)) images.push(file);
        else if (options.canAttachFiles) others.push(file);
    }
    return { images, files: others };
}
