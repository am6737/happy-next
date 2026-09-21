import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

/**
 * The keys a soft keyboard cannot produce.
 *
 * iOS and Android keyboards have no Escape, no Tab, and no arrow keys, so
 * without this bar a terminal on a phone can run commands but cannot use them —
 * no shell history, no vim, no Ctrl-C. Everything here is something the
 * on-screen keyboard structurally cannot send.
 *
 * Labels stay in English on purpose: `esc`, `tab` and `^C` are what every
 * terminal user already reads, and translating them would make the bar harder
 * to recognise, not easier.
 */
export interface TerminalKeyBarProps {
    ctrlActive: boolean;
    onToggleCtrl: () => void;
    /** A key name (`ArrowUp`, `Tab`, …) or a literal character, to be encoded. */
    onKey: (key: string) => void;
    /** Raw bytes, for keys that are not an encoding of anything. */
    onSend: (data: string) => void;
    /** Which shell this is, shown at the end of the row. Dropped when narrow. */
    status?: string;
}

/**
 * Below this the bar is still usable but the description is not: it would be
 * the first thing to run out of room, and the keys are the reason the row is
 * there at all.
 */
const STATUS_MIN_WINDOW_WIDTH = 640;

const NAMED_KEYS: Array<{ label: string; key: string }> = [
    { label: 'esc', key: 'Escape' },
    { label: 'tab', key: 'Tab' },
    { label: '↑', key: 'ArrowUp' },
    { label: '↓', key: 'ArrowDown' },
    { label: '←', key: 'ArrowLeft' },
    { label: '→', key: 'ArrowRight' },
];

const LITERAL_KEYS = ['/', '-', '|', '~'];

const CTRL_C = '\x03';

export const TerminalKeyBar = memo(({ ctrlActive, onToggleCtrl, onKey, onSend, status }: TerminalKeyBarProps) => {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const barColors = {
        bar: theme.colors.surface,
        border: theme.colors.divider,
        button: theme.colors.surfaceHighest,
        label: theme.colors.text,
        active: theme.colors.textLink,
    };

    return (
        <View style={[styles.bar, { backgroundColor: barColors.bar, borderTopColor: barColors.border }]}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.content}
                style={styles.keys}
                keyboardShouldPersistTaps="always"
            >
                {NAMED_KEYS.map((entry) => (
                    <BarButton
                        key={entry.key}
                        colors={barColors}
                        label={entry.label}
                        onPress={() => onKey(entry.key)}
                    />
                ))}
                {/* Ctrl-C gets its own button: interrupting a running command is
                    the one thing a terminal needs constantly, and three taps
                    (ctrl, then c) is too many for it. */}
                <BarButton colors={barColors} label="^C" onPress={() => onSend(CTRL_C)} />
                <BarButton
                    active={ctrlActive}
                    colors={barColors}
                    label="ctrl"
                    onPress={onToggleCtrl}
                />
                {LITERAL_KEYS.map((char) => (
                    <BarButton key={char} colors={barColors} label={char} onPress={() => onKey(char)} />
                ))}
            </ScrollView>
            {status && width >= STATUS_MIN_WINDOW_WIDTH ? (
                <Text
                    numberOfLines={1}
                    style={[styles.status, { color: theme.colors.textSecondary }]}
                >
                    {status}
                </Text>
            ) : null}
        </View>
    );
});

interface BarColors {
    button: string;
    label: string;
    active: string;
}

function BarButton({
    label,
    onPress,
    colors,
    active = false,
}: {
    label: string;
    onPress: () => void;
    colors: BarColors;
    active?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                { backgroundColor: active ? colors.active : colors.button },
                pressed && styles.buttonPressed,
            ]}
        >
            <Text style={[styles.buttonLabel, { color: active ? '#FFFFFF' : colors.label }]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    bar: {
        alignItems: 'center',
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
    },
    keys: {
        flexGrow: 1,
        flexShrink: 1,
    },
    content: {
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    status: {
        flexShrink: 1,
        fontFamily: 'Menlo',
        fontSize: 11,
        maxWidth: 360,
        paddingHorizontal: 10,
    },
    button: {
        alignItems: 'center',
        borderRadius: 6,
        justifyContent: 'center',
        minWidth: 40,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    buttonPressed: {
        opacity: 0.6,
    },
    buttonLabel: {
        fontFamily: 'Menlo',
        fontSize: 13,
    },
});
