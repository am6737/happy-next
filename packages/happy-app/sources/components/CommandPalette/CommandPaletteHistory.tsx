import React from 'react';
import { View, ScrollView, Text, Pressable, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isOutOfView, NavigationAnchor } from './navigationAnchor';

interface CommandPaletteHistoryProps {
    history: string[];
    selectedIndex: number;
    onSelect: (entry: string) => void;
    // Set here, read by the arrow keys
    anchorRef: React.MutableRefObject<NavigationAnchor | null>;
    onRemove: (entry: string) => void;
    onClear: () => void;
}

// Past search terms, in a dropdown under the history button; picking one searches it again
export const CommandPaletteHistory = React.memo(function CommandPaletteHistory({ history, selectedIndex, onSelect, anchorRef, onRemove, onClear }: CommandPaletteHistoryProps) {
    const scrollViewRef = React.useRef<ScrollView>(null);
    const rowRefs = React.useRef<(View | null)[]>([]);
    // As in the results: hovering only highlights, and the arrows start from the hovered row
    // once the selected one has scrolled out of view
    const hoveredIndexRef = React.useRef<number | null>(null);
    const handleHover = (index: number, hovered: boolean) => {
        if (hovered) hoveredIndexRef.current = index;
        else if (hoveredIndexRef.current === index) hoveredIndexRef.current = null;
    };
    anchorRef.current = () => {
        const hovered = hoveredIndexRef.current;
        if (hovered === null) return null;
        const scrollableNode = (scrollViewRef.current as any)?.getScrollableNode?.();
        return isOutOfView(rowRefs.current[selectedIndex], scrollableNode) ? hovered : null;
    };

    React.useEffect(() => {
        (rowRefs.current[selectedIndex] as any)?.scrollIntoView?.({ block: 'nearest' });
    }, [selectedIndex]);

    return (
        <ScrollView
            ref={scrollViewRef}
            style={styles.container}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            <View style={styles.header}>
                <Text style={[styles.title, Typography.default('semiBold')]}>
                    {t('commandPalette.searchHistory')}
                </Text>
                <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button">
                    {({ pressed }) => (
                        <Text style={[styles.clearText, pressed && styles.clearTextPressed, Typography.default()]}>
                            {t('commandPalette.clearSearchHistory')}
                        </Text>
                    )}
                </Pressable>
            </View>
            {history.map((entry, index) => (
                <View key={entry} ref={(ref) => { rowRefs.current[index] = ref; }}>
                    <HistoryRow
                        entry={entry}
                        isSelected={index === selectedIndex}
                        onPress={() => onSelect(entry)}
                        onHover={(hovered) => handleHover(index, hovered)}
                        onRemove={() => onRemove(entry)}
                    />
                </View>
            ))}
        </ScrollView>
    );
});

function HistoryRow({ entry, isSelected, onPress, onHover, onRemove }: {
    entry: string;
    isSelected: boolean;
    onPress: () => void;
    onHover: (hovered: boolean) => void;
    onRemove: () => void;
}) {
    const { theme } = useUnistyles();
    const [isHovered, setIsHovered] = React.useState(false);
    // Touch screens can't hover, so the remove button stays visible there
    const showRemove = Platform.OS !== 'web' || isHovered || isSelected;

    const pressableProps: any = {
        style: ({ pressed }: any) => [
            styles.row,
            isSelected && styles.selected,
            isHovered && !isSelected && styles.hovered,
            pressed && styles.pressed,
        ],
        onPress,
        accessibilityRole: 'button',
        accessibilityLabel: entry,
    };
    if (Platform.OS === 'web') {
        pressableProps.onMouseEnter = () => {
            setIsHovered(true);
            onHover(true);
        };
        pressableProps.onMouseLeave = () => {
            setIsHovered(false);
            onHover(false);
        };
    }

    return (
        <Pressable {...pressableProps}>
            <Ionicons name="time-outline" size={18} color={theme.colors.textSecondary} />
            <Text numberOfLines={1} style={[styles.entryText, Typography.default()]}>
                {entry}
            </Text>
            <Pressable
                onPress={onRemove}
                hitSlop={8}
                style={[styles.removeButton, !showRemove && styles.hidden]}
                accessibilityRole="button"
                accessibilityLabel={t('common.remove')}
            >
                <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
            </Pressable>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        maxHeight: 360,
        paddingBottom: 4,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: theme.dark ? 0.5 : 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 4,
    },
    title: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        fontWeight: '600',
    },
    clearText: {
        fontSize: 12,
        color: theme.colors.textLink,
    },
    clearTextPressed: {
        opacity: 0.6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginHorizontal: 4,
        marginVertical: 2,
        borderRadius: 8,
    },
    selected: {
        backgroundColor: theme.dark ? 'rgba(10, 132, 255, 0.16)' : 'rgba(0, 122, 255, 0.09)',
    },
    hovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    entryText: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        letterSpacing: -0.2,
    },
    removeButton: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hidden: {
        opacity: 0,
    },
}));
