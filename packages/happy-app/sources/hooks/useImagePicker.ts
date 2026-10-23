import * as React from 'react';
import { Platform, Image as NativeImage } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Modal } from '@/modal';
import { LocalImage } from '@/components/ImagePreview';
import { appendWithinLimit } from '@/utils/imageSelection';
import { discardSharedFiles, type SharedFile } from '@/share/sharedContent';

const MAX_DIMENSION = 1568;
const MAX_SIZE_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.8;
const DEFAULT_MAX_IMAGES = 4;
export const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function shouldPassthrough(mimeType: string, width: number, height: number, fileSize?: number): boolean {
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return false;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) return false;
    if (fileSize != null && fileSize > MAX_SIZE_BYTES) return false;
    return true;
}

interface UseImagePickerOptions {
    maxImages?: number;
    maxSizeBytes?: number;
    allowedTypes?: string[];
}

interface UseImagePickerReturn {
    images: LocalImage[];
    /** With `onVideos`, the library also offers videos, which are handed to it rather than added as images. */
    pickFromGallery: (options?: { onVideos?: (videos: ImagePicker.ImagePickerAsset[]) => void }) => Promise<void>;
    pickFromCamera: () => Promise<void>;
    addImageFromUri: (uri: string, mimeType: string) => Promise<void>;
    addImagesFromFiles: (files: File[]) => Promise<void>;
    /** Adds images another app shared, as many as there is room for; returns the rest, to attach as files. */
    addSharedImages: (files: SharedFile[]) => Promise<SharedFile[]>;
    removeImage: (index: number) => void;
    clearImages: () => void;
    initImages: (images: LocalImage[]) => void;
    canAddMore: boolean;
}

/**
 * Compress image with aspect ratio preservation.
 * If either dimension exceeds MAX_DIMENSION, scale down proportionally.
 * Always apply JPEG quality compression.
 *
 * For very large images (>4096px), uses a two-step resize to reduce memory pressure:
 * first halve the dimensions, then resize to the target.
 */
async function compressImage(
    uri: string,
    originalWidth: number,
    originalHeight: number
): Promise<{ uri: string; width: number; height: number }> {
    let currentUri = uri;
    let currentWidth = originalWidth;
    let currentHeight = originalHeight;

    // For very large images, do a coarse resize first to reduce memory pressure
    const LARGE_THRESHOLD = 4096;
    if (currentWidth > LARGE_THRESHOLD || currentHeight > LARGE_THRESHOLD) {
        const halfWidth = Math.round(currentWidth / 2);
        const halfHeight = Math.round(currentHeight / 2);
        const preResult = await ImageManipulator.manipulateAsync(
            currentUri,
            [{ resize: { width: halfWidth, height: halfHeight } }],
            { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
        );
        currentUri = preResult.uri;
        currentWidth = preResult.width;
        currentHeight = preResult.height;
    }

    const actions: ImageManipulator.Action[] = [];

    // Resize to fit within MAX_DIMENSION if still needed
    if (currentWidth > MAX_DIMENSION || currentHeight > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / currentWidth, MAX_DIMENSION / currentHeight);
        const newWidth = Math.round(currentWidth * scale);
        const newHeight = Math.round(currentHeight * scale);
        actions.push({ resize: { width: newWidth, height: newHeight } });
    }

    const manipResult = await ImageManipulator.manipulateAsync(
        currentUri,
        actions,
        { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );

    return {
        uri: manipResult.uri,
        width: manipResult.width,
        height: manipResult.height,
    };
}

async function prepareImage(uri: string, mimeType: string, fileSize?: number): Promise<LocalImage> {
    if (Platform.OS !== 'web') {
        return { uri, width: 512, height: 512, mimeType };
    }

    const image = new Image();
    image.src = uri;
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (shouldPassthrough(mimeType, width, height, fileSize)) {
        return { uri, width, height, mimeType };
    }

    const compressed = await compressImage(uri, width, height);
    return {
        uri: compressed.uri,
        width: compressed.width,
        height: compressed.height,
        mimeType: 'image/jpeg',
    };
}

export function useImagePicker(options: UseImagePickerOptions = {}): UseImagePickerReturn {
    const {
        maxImages = DEFAULT_MAX_IMAGES,
        allowedTypes = DEFAULT_ALLOWED_TYPES,
    } = options;

    const [images, setImages] = React.useState<LocalImage[]>([]);
    const imagesRef = React.useRef(images);
    imagesRef.current = images;

    const canAddMore = images.length < maxImages;

    const addImages = React.useCallback(async (newImages: ImagePicker.ImagePickerAsset[]) => {
        const remaining = maxImages - images.length;
        const toAdd = newImages.slice(0, remaining);

        const processed: LocalImage[] = [];
        for (const img of toAdd) {
            const mimeType = img.mimeType || 'image/jpeg';
            if (!allowedTypes.includes(mimeType)) {
                continue;
            }

            if (shouldPassthrough(mimeType, img.width, img.height, img.fileSize)) {
                processed.push({
                    uri: img.uri,
                    width: img.width,
                    height: img.height,
                    mimeType,
                });
                continue;
            }

            try {
                const compressed = await compressImage(img.uri, img.width, img.height);
                processed.push({
                    uri: compressed.uri,
                    width: compressed.width,
                    height: compressed.height,
                    mimeType: 'image/jpeg',
                });
            } catch (error) {
                console.warn('[ImagePicker] Failed to compress image, using original:', error);
                processed.push({
                    uri: img.uri,
                    width: img.width,
                    height: img.height,
                    mimeType,
                });
            }
        }

        setImages((previous) => appendWithinLimit(previous, processed, maxImages));
    }, [images.length, maxImages, allowedTypes]);

    const pickFromGallery = React.useCallback(async ({ onVideos }: { onVideos?: (videos: ImagePicker.ImagePickerAsset[]) => void } = {}) => {
        // Videos have their own limit, so a full set of images only stops an images-only pick
        if (!canAddMore && !onVideos) {
            Modal.alert('Limit Reached', `Maximum ${maxImages} images allowed`);
            return;
        }

        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Modal.alert('Permission Required', 'Please allow access to your photo library in settings');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: onVideos ? ['images', 'videos'] : ['images'],
                allowsMultipleSelection: true,
                selectionLimit: onVideos ? 0 : maxImages - images.length,
                quality: 0.8,
            });

            if (!result.canceled && result.assets.length > 0) {
                const videos = result.assets.filter((asset) => asset.type === 'video');
                const picked = result.assets.filter((asset) => asset.type !== 'video');
                if (videos.length > 0) onVideos?.(videos);
                if (picked.length > maxImages - images.length) {
                    Modal.alert('Limit Reached', `Maximum ${maxImages} images allowed`);
                }
                if (picked.length > 0) await addImages(picked);
            }
        } catch (error) {
            console.error('[ImagePicker] Gallery pick failed:', error);
            Modal.alert('Error', 'Failed to select image. Please try again.');
        }
    }, [canAddMore, maxImages, images.length, addImages]);

    const pickFromCamera = React.useCallback(async () => {
        if (!canAddMore) {
            Modal.alert('Limit Reached', `Maximum ${maxImages} images allowed`);
            return;
        }

        try {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                Modal.alert('Permission Required', 'Please allow access to your camera in settings');
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.8,
            });

            if (!result.canceled && result.assets.length > 0) {
                await addImages(result.assets);
            }
        } catch (error) {
            console.error('[ImagePicker] Camera pick failed:', error);
            Modal.alert('Error', 'Failed to capture image. Please try again.');
        }
    }, [canAddMore, maxImages, addImages]);

    const addImageFromUri = React.useCallback(async (uri: string, mimeType: string) => {
        if (!canAddMore) {
            Modal.alert('Limit Reached', `Maximum ${maxImages} images allowed`);
            return;
        }

        if (!allowedTypes.includes(mimeType)) {
            Modal.alert('Invalid Type', 'Only JPEG and PNG images are supported');
            return;
        }

        const image = await prepareImage(uri, mimeType);
        setImages((previous) => appendWithinLimit(previous, [image], maxImages));
    }, [canAddMore, maxImages, allowedTypes]);

    const addImagesFromFiles = React.useCallback(async (files: File[]) => {
        if (Platform.OS !== 'web') return;

        const remaining = maxImages - images.length;
        if (remaining <= 0) {
            Modal.alert('Limit Reached', `Maximum ${maxImages} images allowed`);
            return;
        }

        const selectedFiles = files
            .filter((file) => allowedTypes.includes(file.type))
            .slice(0, remaining);
        const prepared = await Promise.all(selectedFiles.map((file) => {
            const uri = URL.createObjectURL(file);
            return prepareImage(uri, file.type, file.size);
        }));

        setImages((previous) => appendWithinLimit(previous, prepared, maxImages));
    }, [allowedTypes, images.length, maxImages]);

    const addSharedImages = React.useCallback(async (files: SharedFile[]) => {
        const room = Math.max(0, maxImages - imagesRef.current.length);
        const rest = files.slice(room);
        const processed: LocalImage[] = [];
        for (const file of files.slice(0, room)) {
            try {
                let { width, height } = file;
                if (!width || !height) {
                    ({ width, height } = await NativeImage.getSize(file.uri));
                }
                if (allowedTypes.includes(file.mimeType) && shouldPassthrough(file.mimeType, width, height, file.size ?? undefined)) {
                    processed.push({ uri: file.uri, width, height, mimeType: file.mimeType });
                    continue;
                }
                // Too large, or a type the agents don't read (HEIC from the photo library): a JPEG
                const compressed = await compressImage(file.uri, width, height);
                processed.push({ ...compressed, mimeType: 'image/jpeg' });
                discardSharedFiles([file]);
            } catch (error) {
                console.warn('[ImagePicker] Shared image could not be read, attaching it as a file:', error);
                rest.push(file);
            }
        }
        setImages((previous) => appendWithinLimit(previous, processed, maxImages));
        return rest;
    }, [maxImages, allowedTypes]);

    const removeImage = React.useCallback((index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    }, []);

    const clearImages = React.useCallback(() => {
        setImages([]);
    }, []);

    const initImages = React.useCallback((newImages: LocalImage[]) => {
        setImages(newImages.slice(0, maxImages));
    }, [maxImages]);

    return {
        images,
        pickFromGallery,
        pickFromCamera,
        addImageFromUri,
        addImagesFromFiles,
        addSharedImages,
        removeImage,
        clearImages,
        initImages,
        canAddMore,
    };
}
