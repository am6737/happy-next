import * as React from 'react';
import { Platform, StyleProp, Text, TextStyle, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SessionProjectLabel } from '@/hooks/useSessionProjectLabel';

/**
 * A project's label on one line: its name, then the detail in a fainter shade, which gives way first
 * when the line runs out of room. On web, hovering shows the full path.
 */
export const ProjectLabelText = React.memo(({ label, fullPath, style }: {
    label: SessionProjectLabel;
    fullPath?: string;
    style: StyleProp<TextStyle>;
}) => {
    return (
        <View
            style={styles.container}
            ref={(el: any) => { if (Platform.OS === 'web' && el && fullPath) el.title = fullPath; }}
        >
            <Text style={[style, styles.name]} numberOfLines={1}>{label.name}</Text>
            {label.detail ? (
                // Cut in the middle: names that differ only at the end, like machines', stay told apart.
                <Text style={[style, styles.detail]} numberOfLines={1} ellipsizeMode="middle">{label.detail}</Text>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexShrink: 1,
        minWidth: 0,
    },
    // The name keeps its width as long as the line has room for it; the detail takes what's left.
    // Both set in full, over whatever flex the text style brings along.
    name: {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: 'auto',
        maxWidth: '100%',
    },
    detail: {
        flexGrow: 0,
        flexShrink: 1,
        flexBasis: 'auto',
        minWidth: 0,
        marginLeft: 6,
        opacity: 0.6,
    },
});
