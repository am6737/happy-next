import { Animated } from 'react-native';

/**
 * A pulse that holds `value` at a handful of levels instead of animating it every frame: from `from`
 * to `to` and back, eased, over `steps` levels each way, one cycle every `2 * halfMs`, then held at
 * `from` for `restMs` before the next.
 *
 * On Android a native-driver animation still redraws the window on every vsync for as long as it
 * runs, so a loop that never ends keeps an otherwise idle screen at 60fps. Measured on the emulator
 * with one running session in view: the session list drew 351 frames in 6 s at 24–40% CPU with a
 * smooth pulse, 40 frames at ~4% CPU with this one. Each level is a zero-length native timing (one
 * frame) and the holds between them are timers, so nothing is drawn while a level is held.
 */
export function steppedPulse(value: Animated.Value, from: number, to: number, halfMs: number, steps: number, restMs = 0): Animated.CompositeAnimation {
    const levels: number[] = [];
    for (let i = 1; i <= steps; i++) {
        levels.push(from + (to - from) * (1 - Math.cos(Math.PI * i / steps)) / 2);
    }
    for (let i = steps - 1; i >= 1; i--) {
        levels.push(levels[i - 1]);
    }
    levels.push(from);
    const holdMs = (halfMs * 2) / levels.length;
    return Animated.loop(Animated.sequence([
        ...levels.flatMap((level) => [
            Animated.timing(value, { toValue: level, duration: 0, useNativeDriver: true }),
            Animated.delay(holdMs),
        ]),
        Animated.delay(restMs),
    ]));
}
