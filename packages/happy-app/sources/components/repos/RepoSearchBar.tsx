import * as React from 'react';
import { View, TextInput, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { isRunningOnMac } from '@/utils/platform';
import { SearchField, searchFieldMetrics } from '@/components/SearchField';

// Under the see-through iOS header the bar sits on the page's grouped background (scrolling with the
// list, or just below the header), so it draws no band of its own: only the field, as the other
// pages' search fields sit on theirs.
const onGroupedBackground = Platform.OS === 'ios' && !isRunningOnMac();

interface RepoSearchBarProps {
    value: string;
    onChange: (text: string) => void;
    placeholder?: string;
    /** When true, the search input is rendered inline below the title, taking full width. */
    expanded: boolean;
    onExpand: () => void;
    onCollapse: () => void;
    cancelLabel?: string;
}

export const RepoSearchBar = React.memo<RepoSearchBarProps>(({ value, onChange, placeholder, expanded, onExpand, onCollapse, cancelLabel = 'Cancel' }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const inputRef = React.useRef<TextInput>(null);
    const opacity = useSharedValue(expanded ? 1 : 0);

    React.useEffect(() => {
        opacity.value = withTiming(expanded ? 1 : 0, { duration: 200 });
        if (expanded) {
            const t = setTimeout(() => inputRef.current?.focus(), 80);
            return () => clearTimeout(t);
        }
    }, [expanded, opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    if (!expanded) {
        return (
            <Pressable onPress={onExpand} hitSlop={8} style={styles.searchIconWrap}>
                <Ionicons name="search" size={20} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    return (
        <Animated.View style={[styles.container, onGroupedBackground && styles.containerGrouped, animatedStyle]}>
            <SearchField
                inputRef={inputRef}
                value={value}
                onChangeText={onChange}
                placeholder={placeholder}
                style={[styles.field, !onGroupedBackground && styles.fieldOnHeader]}
            />
            <Pressable
                onPress={() => {
                    onChange('');
                    onCollapse();
                }}
                hitSlop={8}
                style={styles.cancelBtn}
            >
                <Animated.Text style={styles.cancelText}>{cancelLabel}</Animated.Text>
            </Pressable>
        </Animated.View>
    );
});
RepoSearchBar.displayName = 'RepoSearchBar';

const stylesheet = StyleSheet.create((theme) => ({
    searchIconWrap: {
        paddingHorizontal: 8,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.header.background,
    },
    containerGrouped: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 0,
        backgroundColor: 'transparent',
    },
    field: {
        flex: 1,
    },
    // In the header's band it takes a fill, the header being the cards' colour.
    fieldOnHeader: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    cancelBtn: {
        paddingHorizontal: 4,
    },
    cancelText: {
        fontSize: searchFieldMetrics.fontSize,
        color: theme.colors.textLink,
        ...Typography.default('regular'),
    },
}));
