import * as React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { ComposerInputHeightContext } from '@/components/composerInputHeight';

const GROW = { duration: 120, easing: Easing.out(Easing.quad) };
const SHRINK = { duration: 220, easing: Easing.out(Easing.cubic) };

/**
 * Animates a growing multiline field's height inside a floating composer. The text input keeps
 * sizing itself to its text; a clipping wrapper around it is what animates, from the height it was
 * drawn at to the input's new one — quickly when a line is added, more slowly when it shrinks
 * (sending clears it at once). Both heights are shared with `AgentContentView` through
 * `ComposerInputHeightContext`, which moves the chat list along with the field as it grows.
 *
 * Off (`style` empty, handlers unset) when not asked for or outside a floating composer.
 */
export function useAnimatedInputHeight(enabled: boolean) {
    const composerInputHeight = React.useContext(ComposerInputHeightContext);
    const active = enabled && composerInputHeight !== null;
    const height = composerInputHeight?.height;
    const targetHeight = composerInputHeight?.target;
    const measured = React.useRef(false);

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
        height.value = withTiming(target, target < height.value ? SHRINK : GROW);
    }, [height, targetHeight]);

    const reportLayout = composerInputHeight?.onLayout;
    const onWrapperLayout = React.useCallback((e: LayoutChangeEvent) => {
        reportLayout?.(e.nativeEvent.layout.height);
    }, [reportLayout]);

    React.useEffect(() => {
        if (!active || !height || !targetHeight || !reportLayout) return;
        return () => {
            measured.current = false;
            height.value = 0;
            targetHeight.value = 0;
            reportLayout(0);
        };
    }, [active, height, targetHeight, reportLayout]);

    return active
        ? { style, onInputLayout, onWrapperLayout }
        : { style: undefined, onInputLayout: undefined, onWrapperLayout: undefined };
}
