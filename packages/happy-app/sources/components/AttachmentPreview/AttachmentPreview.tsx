import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { LocalAttachment } from './types';

export const AttachmentPreview = React.memo(function AttachmentPreview(props: {
    attachments: LocalAttachment[];
    onRemove: (index: number) => void;
    disabled?: boolean;
}) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
            {props.attachments.map((attachment, index) => (
                <View key={`${attachment.uri}-${index}`} style={styles.item}>
                    <Ionicons name="document-outline" size={22} color={styles.icon.color} />
                    <View style={styles.labels}>
                        <Text numberOfLines={1} style={styles.name}>{attachment.name}</Text>
                        <Text style={styles.size}>{formatBytes(attachment.size)}</Text>
                    </View>
                    {!props.disabled && (
                        <Pressable onPress={() => props.onRemove(index)} hitSlop={8} accessibilityLabel="Remove attachment">
                            <Ionicons name="close-circle" size={20} color={styles.remove.color} />
                        </Pressable>
                    )}
                </View>
            ))}
        </ScrollView>
    );
});

function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create((theme) => ({
    content: { paddingHorizontal: 8, paddingVertical: 8, gap: 8 },
    item: {
        width: 220, height: 54, flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 10, borderRadius: 8, backgroundColor: theme.colors.surfaceHighest,
    },
    labels: { flex: 1 },
    name: { color: theme.colors.text, fontSize: 13 },
    size: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 },
    icon: { color: theme.colors.textSecondary },
    remove: { color: theme.colors.textSecondary },
}));
