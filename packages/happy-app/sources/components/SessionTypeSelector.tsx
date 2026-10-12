import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';

interface SessionTypeSelectorProps {
    value: 'simple' | 'worktree';
    onChange: (value: 'simple' | 'worktree') => void;
    /** Sits inside the composer's machine/path card: drawn like the settings overlay's tabs, which share that fill. */
    embedded?: boolean;
}

// Same slide as the tabs of the composer's settings overlay.
const INDICATOR_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };
// Padding of the bar, around the options and the sliding selection behind them.
const BAR_PADDING = 2;

const stylesheet = StyleSheet.create((theme, rt) => ({
    container: {
        flexDirection: 'row',
        borderRadius: 10,
        overflow: 'hidden',
        padding: BAR_PADDING,
        backgroundColor: rt.themeName === 'dark' ? theme.colors.surfaceHighest : theme.colors.input.background,
    },
    option: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 8,
    },
    indicator: {
        position: 'absolute',
        top: BAR_PADDING,
        bottom: BAR_PADDING,
        left: BAR_PADDING,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    containerEmbedded: {
        backgroundColor: theme.colors.floatingOverlay.segmentedBackground,
    },
    indicatorEmbedded: {
        backgroundColor: theme.colors.floatingOverlay.segmentedSelected,
        shadowOpacity: 0,
        elevation: 0,
    },
    label: {
        fontSize: 14,
    },
    labelActive: {
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    labelInactive: {
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
}));

const SESSION_TYPES = ['simple', 'worktree'] as const;

export const SessionTypeSelector: React.FC<SessionTypeSelectorProps> = ({ value, onChange, embedded = false }) => {
    const styles = stylesheet;

    // The selection's background slides between options; it is placed without animating on first layout.
    const [barWidth, setBarWidth] = React.useState(0);
    const optionWidth = barWidth > 0 ? (barWidth - BAR_PADDING * 2) / SESSION_TYPES.length : 0;
    const activeIndex = SESSION_TYPES.indexOf(value);
    const indicatorX = useSharedValue(0);
    const indicatorPlacedRef = React.useRef(false);
    React.useEffect(() => {
        if (optionWidth === 0) return;
        const x = activeIndex * optionWidth;
        indicatorX.value = indicatorPlacedRef.current ? withTiming(x, INDICATOR_TIMING) : x;
        indicatorPlacedRef.current = true;
    }, [activeIndex, optionWidth, indicatorX]);
    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
    }));

    return (
        <View style={[styles.container, embedded && styles.containerEmbedded]} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
            {optionWidth > 0 && (
                <Animated.View style={[styles.indicator, embedded && styles.indicatorEmbedded, { width: optionWidth }, indicatorStyle]} />
            )}
            {SESSION_TYPES.map((type) => {
                const isActive = value === type;
                return (
                    <Pressable
                        key={type}
                        onPress={() => {
                            if (isActive) return;
                            hapticsLight();
                            onChange(type);
                        }}
                        style={styles.option}
                    >
                        <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                            {t(`newSession.sessionType.${type}`)}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
};
