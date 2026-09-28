import * as React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { isRunningOnMac } from '@/utils/platform';

/** Whether surfaces floating over content turn into Liquid Glass (iOS 26, not Catalyst). */
export const liquidGlassAvailable = Platform.OS === 'ios' && !isRunningOnMac() && isLiquidGlassAvailable();

type GlassSurfaceProps = ViewProps & {
    /** Liquid Glass behind the content; otherwise a plain view painted `color`. */
    glass: boolean;
    /** The background used when `glass` is off. */
    color?: string;
    /** Tints the glass, for a surface that stands out as the primary action. */
    tint?: string;
    style?: StyleProp<ViewStyle>;
};

/**
 * A composer surface (input pill, round button, card) that turns into Liquid Glass when the composer
 * floats over the chat (see `floatingComposerAvailable`). The glass is a separate view behind the
 * content, as `AgentInput` does it, and takes the surface's corner radius so its shape matches.
 */
export const GlassSurface = React.memo(({ glass, color, tint, style, children, ...props }: GlassSurfaceProps) => {
    if (!glass) {
        return (
            <View {...props} style={[style, color !== undefined && { backgroundColor: color }]}>
                {children}
            </View>
        );
    }
    const { borderRadius } = StyleSheet.flatten(style) ?? {};
    return (
        <View {...props} style={style}>
            <GlassView pointerEvents="none" glassEffectStyle="regular" tintColor={tint} style={[StyleSheet.absoluteFill, { borderRadius }]} />
            {children}
        </View>
    );
});
GlassSurface.displayName = 'GlassSurface';
