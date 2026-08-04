import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { SESSION_MARKER_COLORS, type SessionMarkerColor } from '@/sync/sessionAppearance';
import { useSessionMarkerColor } from '@/sync/storage';

export const SESSION_MARKER_COLOR_VALUES: Record<SessionMarkerColor, string> = {
    red: '#FF5F57',
    orange: '#FF9F0A',
    yellow: '#FFD60A',
    green: '#30C759',
    blue: '#0A84FF',
    purple: '#BF5AF2',
    gray: '#8E8E93',
};

const styles = StyleSheet.create((theme) => ({
    marker: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 7,
        flexShrink: 0,
    },
    paletteSection: {
        height: 64,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    paletteSectionCompact: {
        height: 46,
        paddingHorizontal: 8,
    },
    palette: {
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 2,
    },
    paletteCompact: {
        justifyContent: 'flex-start',
    },
    swatchButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    swatch: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

const colorLabels: Record<SessionMarkerColor, () => string> = {
    red: () => t('sessionInfo.markerRed'),
    orange: () => t('sessionInfo.markerOrange'),
    yellow: () => t('sessionInfo.markerYellow'),
    green: () => t('sessionInfo.markerGreen'),
    blue: () => t('sessionInfo.markerBlue'),
    purple: () => t('sessionInfo.markerPurple'),
    gray: () => t('sessionInfo.markerGray'),
};

export function SessionColorMarker({ color }: { color: SessionMarkerColor | null }) {
    if (!color) return null;
    return (
        <View
            style={[styles.marker, { backgroundColor: SESSION_MARKER_COLOR_VALUES[color] }]}
            accessibilityLabel={colorLabels[color]()}
        />
    );
}

export function SessionColorMarkerForSession({ sessionId }: { sessionId: string }) {
    return <SessionColorMarker color={useSessionMarkerColor(sessionId)} />;
}

export function SessionColorPalette({
    selectedColor,
    onSelect,
    compact = false,
}: {
    selectedColor: SessionMarkerColor | null;
    onSelect: (color: SessionMarkerColor | null) => void;
    compact?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.paletteSection, compact && styles.paletteSectionCompact]}>
            <View style={[styles.palette, compact && styles.paletteCompact]}>
                {SESSION_MARKER_COLORS.map(color => {
                    const selected = selectedColor === color;
                    const checkColor = color === 'yellow' || color === 'orange' || color === 'green'
                        ? '#3A3A3C'
                        : '#FFFFFF';
                    return (
                        <Pressable
                            key={color}
                            accessibilityRole="button"
                            accessibilityLabel={colorLabels[color]()}
                            accessibilityHint={selected ? t('sessionInfo.clearColorMarker') : undefined}
                            accessibilityState={{ selected }}
                            onPress={() => onSelect(selected ? null : color)}
                            style={({ pressed }) => [
                                styles.swatchButton,
                                compact && { width: 26, height: 26 },
                                pressed && { backgroundColor: theme.colors.surfacePressed },
                            ]}
                        >
                            <View
                                style={[
                                    styles.swatch,
                                    { backgroundColor: SESSION_MARKER_COLOR_VALUES[color] },
                                ]}
                            >
                                {selected ? <Ionicons name="checkmark" size={12} color={checkColor} /> : null}
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}
