import * as React from 'react';
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ImageViewer } from '@/components/ImageViewer';
import { CopyableText } from '@/components/LongPressCopy';
import { t } from '@/text';
import { FilePreviewLoadError } from '@/components/FilePreview/loadFilePreview';
import { ToolError } from '../ToolError';
import { getViewImagePath, getViewImageDisplayPath } from '../viewImageInput';
import { loadToolImagePreview, ToolImagePreviewError } from '../loadToolImagePreview';
import type { ToolViewProps } from './_all';

function errorText(error: unknown): string {
    if (error instanceof ToolImagePreviewError) {
        switch (error.message) {
            case 'image_not_registered': return t('files.preview.imageNotRegistered');
            case 'image_missing': return t('files.preview.imageMissing');
            case 'image_changed': return t('files.preview.imageChanged');
            case 'image_unsupported': return t('files.preview.unsupported');
        }
    }
    if (error instanceof FilePreviewLoadError) {
        if (error.code === 'too_large') return t('files.preview.tooLarge');
        if (error.code === 'denied') return t('files.preview.denied');
        if (error.code === 'expired') return t('files.preview.expired');
    }
    return t('files.preview.unavailable');
}

export const ViewImageViewFull = React.memo(({ tool, sessionId, metadata }: ToolViewProps) => {
    const { theme } = useUnistyles();
    const { height } = useWindowDimensions();
    const path = getViewImagePath(tool.input);
    const displayPath = getViewImageDisplayPath(tool.input, metadata?.homeDir);
    const [attempt, setAttempt] = React.useState(0);
    const [uri, setUri] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [fullscreen, setFullscreen] = React.useState(false);

    React.useEffect(() => {
        const controller = new AbortController();
        setUri(null);
        setError(null);
        setFullscreen(false);
        setLoading(false);
        if (tool.state !== 'completed') return () => controller.abort();
        if (!sessionId || !tool.callId || !path) {
            setError(t('files.preview.imageNotRegistered'));
            return () => controller.abort();
        }
        setLoading(true);
        void loadToolImagePreview(sessionId, tool.callId, controller.signal).then((imageUri) => {
            if (!controller.signal.aborted) setUri(imageUri);
        }).catch((cause) => {
            if (!controller.signal.aborted) setError(errorText(cause));
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [sessionId, tool.callId, tool.state, path, attempt]);

    const toolError = tool.state === 'error'
        ? typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result ?? t('common.error'))
        : null;

    return (
        <View style={styles.container}>
            {displayPath && <CopyableText style={styles.path}>{displayPath}</CopyableText>}
            {toolError ? <ToolError message={toolError} /> : (
                <View style={[styles.preview, { height: Math.max(240, Math.min(640, height - 220)) }]}>
                    {loading || tool.state === 'running' ? (
                        <ActivityIndicator accessibilityLabel={t('files.preview.loading')} color={theme.colors.textSecondary} />
                    ) : error ? (
                        <View style={styles.failure}>
                            <Ionicons name="image-outline" size={28} color={theme.colors.textSecondary} />
                            <Text style={styles.error} accessibilityRole="alert">{error}</Text>
                            <Pressable
                                style={styles.retry}
                                accessibilityRole="button"
                                accessibilityLabel={t('common.retry')}
                                onPress={() => setAttempt((value) => value + 1)}
                            >
                                <Ionicons name="reload" size={18} color={theme.colors.text} />
                                <Text style={styles.retryText}>{t('common.retry')}</Text>
                            </Pressable>
                        </View>
                    ) : uri ? (
                        <Pressable style={styles.image} onPress={() => setFullscreen(true)} accessibilityRole="button" accessibilityLabel={t('files.preview.fullscreen')}>
                            <Image
                                source={{ uri }}
                                style={{ width: '100%', height: '100%' }}
                                contentFit="contain"
                                accessibilityLabel={displayPath ?? t('tools.names.viewImage')}
                                onError={() => setError(t('files.preview.renderError'))}
                            />
                        </Pressable>
                    ) : null}
                </View>
            )}
            {uri && !error && <ImageViewer images={[{ uri }]} visible={fullscreen} onClose={() => setFullscreen(false)} />}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: { paddingHorizontal: 12, paddingBottom: 24, gap: 16 },
    path: { fontSize: 13, lineHeight: 20, color: theme.colors.textSecondary, flexShrink: 1 },
    preview: { width: '100%', alignItems: 'center', justifyContent: 'center' },
    image: { width: '100%', height: '100%' },
    failure: { alignItems: 'center', gap: 16, maxWidth: 420, padding: 16 },
    error: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: theme.colors.textSecondary },
    retry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16 },
    retryText: { fontSize: 14, color: theme.colors.text },
}));
