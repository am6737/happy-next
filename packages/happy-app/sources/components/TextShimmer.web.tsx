import * as React from 'react';
import { Text, TextStyle } from 'react-native';

const SWEEP_MS = 2200;
/**
 * The gradient is twice the text's width, so a window over it sees half of it at a time: walking
 * that window from 100% to 0% slides it right across the gradient — one clean pass, the band
 * entering at one end of the text and leaving at the other.
 *
 * It stops at the ends of the gradient on purpose. Past them there is no colour to paint the
 * glyphs with, and since the glyphs *are* the gradient, the text would simply vanish.
 */
const SWEEP_KEYFRAMES: Keyframe[] = [
    { backgroundPosition: '100% 0' },
    { backgroundPosition: '0% 0' },
];
/** How far the text holds back between passes of the light. */
const BASE_ALPHA = 0.32;

/** The same colour, see-through, so the row behind it shows through and the glyphs read as dim. */
function dimmed(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const n = Number.parseInt(full, 16);
    if (Number.isNaN(n)) return hex;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * A line of text with a band of light travelling across it, for something that is still working.
 *
 * The light is a gradient the glyphs are painted with — they are made transparent, so only the
 * gradient shows — and it travels by moving that gradient. The band is narrow and the text holds
 * back either side of it, so what moves reads as light crossing the text rather than the text
 * changing colour.
 *
 * Both the painting and the travel are applied to the DOM node directly rather than through React
 * Native's style system. The styles are dropped there (`backgroundClip` survives as `border-box`,
 * and the gradient never lands at all), and the travel could not go through an animation library
 * anyway: this build has Reanimated's `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` off, so a Reanimated
 * style update is a shadow tree clone and a full Yoga layout per frame — and this one runs for as
 * long as a turn does. `element.animate` hands it to the compositor instead; nothing commits. Same
 * reasoning, and same `prefers-reduced-motion` courtesy, as the shake after a minimap jump.
 */
export const TextShimmer = React.memo((props: {
    children: React.ReactNode;
    style?: TextStyle | TextStyle[];
    /** The text's own colour, which the light passes through. */
    baseColor: string;
    /** What it comes up to as it passes. */
    highlightColor: string;
}) => {
    const ref = React.useRef<React.ComponentRef<typeof Text>>(null);

    React.useEffect(() => {
        const node = ref.current as unknown as HTMLElement | null;
        if (!node || !node.style) return;

        // The base is the text's own colour held back, and the band is that colour at full
        // strength. A band *brighter* than the text would have nowhere to go on a light theme, and
        // on a dark one the difference between the two is too small to read as a sweep at all.
        const base = dimmed(props.baseColor, BASE_ALPHA);
        node.style.backgroundImage = `linear-gradient(90deg, ${base} 0%, ${base} 45%, ${props.highlightColor} 50%, ${base} 55%, ${base} 100%)`;
        // Underneath the gradient, so the text is never left with nothing to be painted with.
        node.style.backgroundColor = base;
        node.style.backgroundSize = '200% 100%';
        node.style.backgroundRepeat = 'no-repeat';
        node.style.backgroundClip = 'text';
        node.style.webkitBackgroundClip = 'text';
        node.style.color = 'transparent';

        if (typeof node.animate !== 'function') return;
        if (typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const animation = node.animate(SWEEP_KEYFRAMES, {
            duration: SWEEP_MS,
            iterations: Infinity,
            easing: 'linear',
        });
        return () => animation.cancel();
    }, [props.baseColor, props.highlightColor]);

    return <Text ref={ref} style={props.style} numberOfLines={1}>{props.children}</Text>;
});
