import * as React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { ComposerInputHeightContext } from '@/components/composerInputHeight';

const GROW = { duration: 120, easing: Easing.out(Easing.quad) };
const SHRINK = { duration: 220, easing: Easing.out(Easing.cubic) };
/** How long a send freezes the list when the field never gets to shrink (it was one line already). */
const SEND_FREEZE_MAX_MS = 500;
/** How long the composer's dock animates a shrink after a send (`KeyboardDockView.shrinkDuration`). */
const NATIVE_SHRINK_MS = 300;

/**
 * Animates a growing multiline field's height inside a floating composer. The text input keeps
 * sizing itself to its text; a clipping wrapper around it is what animates, from the height it was
 * drawn at to the input's new one — quickly when a line is added, more slowly when it shrinks
 * (sending clears it at once). Both heights are shared with `AgentContentView` through
 * `ComposerInputHeightContext`, which moves the chat list along with the field as it grows.
 *
 * Clearing the field (a send) freezes the list's scroll view until the shrink that follows is
 * done, so it does not move the list down for the composer while the list scrolls to the prompt.
 * Where the composer's dock can animate that shrink natively, the field takes its new height at
 * once and the dock animates it: the shrink lands as the prompt renders and the list scrolls,
 * when a height animated here keeps missing frames.
 *
 * Off (`style` empty, handlers unset) when not asked for or outside a floating composer.
 */
export function useAnimatedInputHeight(enabled: boolean, value: string) {
    const composerInputHeight = React.useContext(ComposerInputHeightContext);
    const active = enabled && composerInputHeight !== null;
    const height = composerInputHeight?.height;
    const targetHeight = composerInputHeight?.target;
    const freeze = composerInputHeight?.freeze;
    const prepareSendShrink = composerInputHeight?.prepareSendShrink;
    const measured = React.useRef(false);
    // Set from the field being cleared until its shrink starts.
    const sending = React.useRef(false);
    // Whether the dock animates the shrink after this send.
    const nativeShrink = React.useRef(false);
    const freezeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const previousValue = React.useRef(value);

    const clearFreezeTimer = React.useCallback(() => {
        if (freezeTimer.current !== null) {
            clearTimeout(freezeTimer.current);
            freezeTimer.current = null;
        }
    }, []);

    // A layout effect, so the freeze is set before the cleared input is laid out at its new height.
    React.useLayoutEffect(() => {
        const cleared = value === '' && previousValue.current !== '';
        previousValue.current = value;
        if (!active || !freeze || !prepareSendShrink || !cleared) return;
        sending.current = true;
        nativeShrink.current = prepareSendShrink();
        freeze.value = true;
        clearFreezeTimer();
        freezeTimer.current = setTimeout(() => {
            freezeTimer.current = null;
            sending.current = false;
            freeze.value = false;
        }, SEND_FREEZE_MAX_MS);
    }, [active, value, freeze, prepareSendShrink, clearFreezeTimer]);

    const style = useAnimatedStyle(() => (
        // 0 until the input has been measured: the wrapper takes the input's height on its own.
        height && height.value > 0 ? { height: height.value } : {}
    ), [height]);

    const onInputLayout = React.useCallback((e: LayoutChangeEvent) => {
        if (!height || !targetHeight) return;
        const target = e.nativeEvent.layout.height;
        targetHeight.value = target;
        if (!measured.current) {
            measured.current = true;
            height.value = target;
            return;
        }
        if (target < height.value && sending.current && freeze) {
            sending.current = false;
            clearFreezeTimer();
            if (nativeShrink.current) {
                height.value = target;
                freezeTimer.current = setTimeout(() => {
                    freezeTimer.current = null;
                    freeze.value = false;
                }, NATIVE_SHRINK_MS);
                return;
            }
            height.value = withTiming(target, SHRINK, () => {
                'worklet';
                freeze.value = false;
            });
            return;
        }
        height.value = withTiming(target, target < height.value ? SHRINK : GROW);
    }, [height, targetHeight, freeze, clearFreezeTimer]);

    const reportLayout = composerInputHeight?.onLayout;
    const onWrapperLayout = React.useCallback((e: LayoutChangeEvent) => {
        reportLayout?.(e.nativeEvent.layout.height);
    }, [reportLayout]);

    React.useEffect(() => {
        if (!active || !height || !targetHeight || !reportLayout) return;
        return () => {
            measured.current = false;
            sending.current = false;
            clearFreezeTimer();
            if (freeze) freeze.value = false;
            height.value = 0;
            targetHeight.value = 0;
            reportLayout(0);
        };
    }, [active, height, targetHeight, reportLayout, freeze, clearFreezeTimer]);

    return active
        ? { style, onInputLayout, onWrapperLayout }
        : { style: undefined, onInputLayout: undefined, onWrapperLayout: undefined };
}
