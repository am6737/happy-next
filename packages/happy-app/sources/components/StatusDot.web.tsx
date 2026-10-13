import * as React from 'react';
import { View, ViewStyle } from 'react-native';
import type { StatusDotProps } from './StatusDot';

/** The dimmest the pulse goes, and how long each half of the cycle takes — the same as native. */
const PULSE_MIN_OPACITY = 0.3;
const PULSE_HALF_MS = 1000;
/** How long a dot takes to settle back to full when the pulse stops. */
const SETTLE_MS = 200;

const PULSE_KEYFRAMES: Keyframe[] = [
    { opacity: 1 },
    { opacity: PULSE_MIN_OPACITY },
    { opacity: 1 },
];

/**
 * The web dot pulses with `element.animate` rather than `Animated`. react-native-web has no native
 * driver, so `Animated` falls back to the JavaScript one, which re-renders the dot on every frame —
 * and each new opacity becomes a new Unistyles class written into the page's stylesheet. With a
 * dot pulsing for every busy session in the sidebar, that kept the main thread rendering for as
 * long as any turn ran. The compositor does the pulse here; nothing renders.
 */
export const StatusDot = React.memo(({ color, isPulsing, size = 6, style }: StatusDotProps) => {
    const ref = React.useRef<View>(null);

    React.useEffect(() => {
        const node = ref.current as unknown as HTMLElement | null;
        if (!node || typeof node.animate !== 'function') return;

        if (!isPulsing) {
            return;
        }
        if (typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const pulse = node.animate(PULSE_KEYFRAMES, {
            duration: PULSE_HALF_MS * 2,
            iterations: Infinity,
            easing: 'ease-in-out',
        });
        return () => {
            // Settle from wherever the pulse was rather than snapping back to full.
            const from = Number(getComputedStyle(node).opacity);
            pulse.cancel();
            if (from < 1) {
                node.animate([{ opacity: from }, { opacity: 1 }], { duration: SETTLE_MS, easing: 'ease-out' });
            }
        };
    }, [isPulsing]);

    const baseStyle: ViewStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
    };

    return <View ref={ref} style={[baseStyle, style]} />;
});
