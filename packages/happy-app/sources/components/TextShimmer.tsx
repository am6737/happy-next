import * as React from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useReducedMotion } from 'react-native-reanimated';
import { BASE_ALPHA, PAUSE_MS, SWEEP_MS, dimmed } from './textShimmerShared';

/** The band's width, as a share of the text's — the same narrow band as the web gradient's 45–55% of twice the text. */
const BAND = 0.2;
/** How far past each edge of the text the band's centre starts and ends, so a pass begins and ends with no glyph lit. */
const OVERRUN = 0.15;

/** The style keys that place the line in its row; everything else is about the glyphs. */
const LAYOUT_KEYS = new Set<string>([
    'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
    'width', 'minWidth', 'maxWidth',
    'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'marginHorizontal', 'marginVertical',
    'padding', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'paddingHorizontal', 'paddingVertical',
]);

function splitStyle(style: TextStyle | TextStyle[] | undefined): { layout: ViewStyle; text: TextStyle } {
    const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
    const layout: Record<string, unknown> = {};
    const text: Record<string, unknown> = {};
    for (const key of Object.keys(flat)) {
        (LAYOUT_KEYS.has(key) ? layout : text)[key] = flat[key];
    }
    return { layout: layout as ViewStyle, text: text as TextStyle };
}

/**
 * A line of text with a band of light travelling across it, for something that is still working.
 *
 * The text is drawn at its resting, held-back colour, and over it a copy of the same text masks a
 * narrow gradient that travels across: where the band is, the glyphs come up to the highlight;
 * either side of it the gradient is clear and the resting text shows through. Pace, band and
 * resting strength are the web implementation's (TextShimmer.web.tsx).
 *
 * The travel is a translate on React Native's own Animated with the native driver, not Reanimated:
 * this build has Reanimated's `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` off, so a Reanimated style update
 * is a shadow tree commit per frame — and this runs for as long as a turn does. The native driver
 * moves the view on the UI thread without committing anything.
 *
 * The line's place in its row (flex, margins, padding) goes on a wrapper, and the text and its mask
 * sit inside the padding, so the mask lines up with the glyphs and truncates the same way.
 */
export const TextShimmer = React.memo((props: {
    children: React.ReactNode;
    style?: TextStyle | TextStyle[];
    /** The text's own colour, which the light passes through. */
    baseColor: string;
    /** What it comes up to as it passes. */
    highlightColor: string;
}) => {
    const { layout, text } = React.useMemo(() => splitStyle(props.style), [props.style]);
    const [width, setWidth] = React.useState(0);
    const reducedMotion = useReducedMotion();
    const progress = React.useRef(new Animated.Value(0)).current;

    const onLayout = React.useCallback((e: LayoutChangeEvent) => {
        setWidth(Math.round(e.nativeEvent.layout.width));
    }, []);

    const animating = width > 0 && !reducedMotion;
    React.useEffect(() => {
        if (!animating) return;
        // The pause is the tail of the same loop: the band leaves, then everything rests.
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(progress, {
                toValue: 1,
                duration: SWEEP_MS,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
            Animated.delay(PAUSE_MS),
        ]));
        loop.start();
        return () => {
            loop.stop();
            progress.setValue(0);
        };
    }, [animating, progress]);

    const band = width * BAND;
    const translateX = React.useMemo(() => progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-OVERRUN * width - band / 2, (1 + OVERRUN) * width - band / 2],
    }), [progress, width, band]);

    const clear = dimmed(props.baseColor, 0);

    return (
        <View style={layout}>
            <View onLayout={onLayout}>
                <Text style={[text, { color: dimmed(props.baseColor, BASE_ALPHA) }]} numberOfLines={1}>
                    {props.children}
                </Text>
                {animating && (
                    <MaskedView
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                        maskElement={
                            <Text style={[text, styles.mask]} numberOfLines={1}>{props.children}</Text>
                        }
                    >
                        <Animated.View style={[styles.band, { width: band, transform: [{ translateX }] }]}>
                            <LinearGradient
                                colors={[clear, props.highlightColor, clear]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={StyleSheet.absoluteFill}
                            />
                        </Animated.View>
                    </MaskedView>
                )}
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    // Only the glyphs' alpha matters to a mask.
    mask: {
        color: '#000',
    },
    band: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
    },
});
