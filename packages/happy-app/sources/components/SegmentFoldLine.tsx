import * as React from 'react';
import { Animated, Easing, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { TextShimmer } from './TextShimmer';
import { FoldDelegatedMark } from './FoldDelegatedMark';

/** How long the chevron takes to swing between open and folded. Matches the turn's own line. */
const CHEVRON_TURN_MS = 180;

/**
 * The line a run of steps folds to: a chevron and how many steps it ran, tap to open or close.
 *
 * It is the turn line's smaller sibling and looks like it, minus the clock and the hairline — the
 * turn's line is what the turn cost and what divides it from the answer, while this one sits between
 * the agent's own words and has nothing to divide. A run that is still going says what it is doing at
 * the far end of the line, the same way the turn's line does.
 */
export const SegmentFoldLine = React.memo((props: {
    folded: boolean;
    /** Tool calls the run holds. */
    steps: number;
    /** What the run is doing right now. Only a run still going has one, and only while folded. */
    snapshot?: string;
    /**
     * A delegated task the folded run hides is still running: what it was asked to do, or null when
     * there is nothing to say of it. Undefined when none is. Shown only when there is no snapshot.
     */
    delegated?: string | null;
    running: boolean;
    onToggle: () => void;
}) => {
    const { theme } = useUnistyles();
    const { folded, steps, snapshot, delegated, running, onToggle } = props;

    // One glyph that turns, rather than two icons swapped, and with the native driver for the same
    // reason the turn's line does it: see TurnHeader.
    const turn = React.useRef(new Animated.Value(folded ? 1 : 0)).current;
    React.useEffect(() => {
        Animated.timing(turn, {
            toValue: folded ? 1 : 0,
            duration: CHEVRON_TURN_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [folded, turn]);
    const rotation = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] });

    // Said the same folded or open: what the line reports is the run, not the state of the line.
    const label = running ? t('message.segmentRunning', { steps }) : t('message.segmentSteps', { steps });

    return (
        <Pressable
            style={styles.row}
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: !folded }}
            accessibilityLabel={`${label}. ${folded ? t('message.expandProcess') : t('message.foldProcess')}`}
        >
            <Animated.View style={[styles.chevron, { transform: [{ rotate: rotation }] }]}>
                <Ionicons name="chevron-down" size={12} color={theme.colors.textSecondary} />
            </Animated.View>
            <Text style={styles.text} numberOfLines={1}>{label}</Text>
            {snapshot ? (
                running ? (
                    <TextShimmer
                        style={styles.snapshotLive}
                        baseColor={theme.colors.textSecondary}
                        highlightColor={theme.colors.text}
                    >
                        {snapshot}
                    </TextShimmer>
                ) : (
                    <Text style={styles.snapshot} numberOfLines={1}>{snapshot}</Text>
                )
            ) : delegated !== undefined ? (
                <FoldDelegatedMark label={delegated} />
            ) : null}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 4,
    },
    chevron: {
        marginLeft: -2,
        width: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 0,
    },
    snapshot: {
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
        opacity: 0.7,
    },
    snapshotLive: {
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
