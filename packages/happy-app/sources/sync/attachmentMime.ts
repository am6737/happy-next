const MODEL_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

export function getAttachmentKind(mimeType: string): 'image' | 'file' {
    const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
    return MODEL_IMAGE_MIME_TYPES.has(normalizedMimeType) ? 'image' : 'file';
}
