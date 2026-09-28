import * as React from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { GlassView } from 'expo-glass-effect';

type GlassSurfaceProps = ViewProps & {
    /** Liquid Glass behind the content; otherwise a plain view painted `color`. */
    glass: boolean;
    /** The background used when `glass` is off. */
    color?: string;
    style?: StyleProp<ViewStyle>;
};

/**
 * A composer surface (input pill, round button, card) that turns into Liquid Glass when the composer
 * floats over the chat (see `floatingComposerAvailable`). The glass is a separate view behind the
 * content, as `AgentInput` does it, and takes the surface's corner radius so its shape matches.
 */
export const GlassSurface = React.memo(({ glass, color, style, children, ...props }: GlassSurfaceProps) => {
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
            <GlassView pointerEvents="none" glassEffectStyle="regular" style={[StyleSheet.absoluteFill, { borderRadius }]} />
            {children}
        </View>
    );
});
GlassSurface.displayName = 'GlassSurface';
