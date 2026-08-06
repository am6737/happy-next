import type { LocalAttachment } from '@/components/AttachmentPreview';
import type { LocalImage } from '@/components/ImagePreview';

export function localImagesToAttachments(images: LocalImage[]): LocalAttachment[] {
    return images.map((image, index) => {
        const extension = image.mimeType === 'image/png' ? 'png'
            : image.mimeType === 'image/webp' ? 'webp'
                : 'jpg';
        return {
            uri: image.uri,
            name: `image-${index + 1}.${extension}`,
            mimeType: image.mimeType,
            size: 0,
            image: { width: image.width, height: image.height },
        };
    });
}
