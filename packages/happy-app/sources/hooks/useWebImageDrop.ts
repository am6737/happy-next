import * as React from 'react';
import { Platform, View } from 'react-native';
import { getDroppedImageFiles, isFileDrag } from '@/utils/imageDrop';

interface UseWebImageDropOptions {
    enabled: boolean;
    onImageDrop?: (files: File[]) => void | Promise<void>;
}

export function useWebImageDrop(options: UseWebImageDropOptions) {
    const [isDragging, setIsDragging] = React.useState(false);
    const dragCounterRef = React.useRef(0);
    const dropZoneRef = React.useRef<View>(null);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || !options.enabled) {
            dragCounterRef.current = 0;
            setIsDragging(false);
            return;
        }

        const element = dropZoneRef.current as unknown as HTMLElement | null;
        if (!element) return;

        const resetDragState = () => {
            dragCounterRef.current = 0;
            setIsDragging(false);
        };
        const handleDragEnter = (event: DragEvent) => {
            if (!isFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            dragCounterRef.current += 1;
            setIsDragging(true);
        };
        const handleDragLeave = (event: DragEvent) => {
            if (!isFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
            if (dragCounterRef.current === 0) setIsDragging(false);
        };
        const handleDragOver = (event: DragEvent) => {
            if (!isFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        };
        const handleDrop = (event: DragEvent) => {
            if (!isFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            resetDragState();

            const files = getDroppedImageFiles(event.dataTransfer);
            if (files.length > 0) void options.onImageDrop?.(files);
        };

        element.addEventListener('dragenter', handleDragEnter);
        element.addEventListener('dragleave', handleDragLeave);
        element.addEventListener('dragover', handleDragOver);
        element.addEventListener('drop', handleDrop);
        window.addEventListener('blur', resetDragState);
        window.addEventListener('dragend', resetDragState);
        window.addEventListener('drop', resetDragState);

        return () => {
            element.removeEventListener('dragenter', handleDragEnter);
            element.removeEventListener('dragleave', handleDragLeave);
            element.removeEventListener('dragover', handleDragOver);
            element.removeEventListener('drop', handleDrop);
            window.removeEventListener('blur', resetDragState);
            window.removeEventListener('dragend', resetDragState);
            window.removeEventListener('drop', resetDragState);
        };
    }, [options.enabled, options.onImageDrop]);

    return { dropZoneRef, isDragging };
}
