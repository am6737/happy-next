export function isFileDrag(dataTransfer: Pick<DataTransfer, 'types'> | null): boolean {
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types).includes('Files');
}

export function getDroppedImageFiles(dataTransfer: Pick<DataTransfer, 'files'> | null): File[] {
    if (!dataTransfer) return [];
    return Array.from(dataTransfer.files).filter((file) => file.type.startsWith('image/'));
}
