import * as React from 'react';
import { Animated, Easing, ViewStyle } from 'react-native';

export interface StatusDotProps {
    color: string;
    isPulsing?: boolean;
    size?: number;
    style?: ViewStyle;
}

/** The dimmest the pulse goes, and how long each half of the cycle takes. */
const PULSE_MIN_OPACITY = 0.3;
const PULSE_HALF_MS = 1000;
/** How long a dot takes to settle back to full when the pulse stops. */
const SETTLE_MS = 200;

/**
 * A dot that can pulse forever. The pulse is deliberately driven by `Animated`
 * with the native driver rather than by Reanimated: on iOS this build has
 * `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` off, so a Reanimated style update is not a
 * write to the view but a synchronous clone of the whole shadow tree followed by
 * a full Yoga layout. A dot that only fades must not cost that once per frame.
 */
export const StatusDot = React.memo(({ color, isPulsing, size = 6, style }: StatusDotProps) => {
    const opacity = React.useRef(new Animated.Value(1)).current;

    React.useEffect(() => {
        if (!isPulsing) {
            Animated.timing(opacity, {
                toValue: 1,
                duration: SETTLE_MS,
                useNativeDriver: true,
            }).start();
            return;
        }

        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: PULSE_MIN_OPACITY,
                    duration: PULSE_HALF_MS,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: PULSE_HALF_MS,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
            ])
        );
        pulse.start();

        return () => pulse.stop();
    }, [isPulsing, opacity]);

    const baseStyle: ViewStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
    };

    return (
        <Animated.View
            style={[
                baseStyle,
                { opacity },
                style
            ]}
        />
    );
});
