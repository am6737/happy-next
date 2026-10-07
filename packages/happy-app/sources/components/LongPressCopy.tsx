import * as React from 'react';
import { Platform, Text, TextProps, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { storeTempText } from '@/sync/persistence';
import type { TextDocumentFormat } from '@/utils/textDocument';

/**
 * Returns whether Text elements should use native `selectable` prop.
 * On mobile, selectable is disabled in favor of the long-press → text-selection page flow.
 */
export function useCopySelectable(): boolean {
    return Platform.OS === 'web';
}

/**
 * Wrapper that adds long-press → text-selection page navigation on mobile.
 * On web, renders children as-is (relying on native selectable text).
 */
export function LongPressCopy({ text, format, language, children, style }: {
    text: string;
    format?: TextDocumentFormat;
    language?: string;
    children: React.ReactNode;
    style?: ViewStyle;
}) {
    const selectable = useCopySelectable();
    const router = useRouter();

    const handleLongPress = React.useCallback(() => {
        try {
            const textId = storeTempText(text);
            router.push({ pathname: '/text-selection', params: { textId, format, language } });
        } catch (error) {
            console.error('Error storing text for selection:', error);
        }
    }, [text, format, language, router]);

    if (selectable) {
        return <>{children}</>;
    }

    const longPressGesture = Gesture.LongPress()
        .minDuration(500)
        .onStart(handleLongPress)
        .runOnJS(true);

    return (
        <GestureDetector gesture={longPressGesture}>
            <View style={style}>{children}</View>
        </GestureDetector>
    );
}

/**
 * Shorthand for LongPressCopy + Text + selectable.
 * Use when the copyable content is a simple Text element.
 * For complex content (View wrapping, multiple children), use LongPressCopy directly.
 */
export function CopyableText({ copyText, children, ...textProps }: TextProps & { copyText?: string }) {
    const selectable = useCopySelectable();
    const resolvedCopyText = copyText ?? (typeof children === 'string' ? children : '');

    return (
        <LongPressCopy text={resolvedCopyText}>
            <Text selectable={selectable} {...textProps}>
                {children}
            </Text>
        </LongPressCopy>
    );
}
