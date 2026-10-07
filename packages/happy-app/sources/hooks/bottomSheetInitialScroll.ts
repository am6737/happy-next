// Lets a bottom-sheet scrollable open already scrolled to a given offset. While the sheet animates
// in, @gorhom/bottom-sheet locks its scrollable and snaps every scroll event back to the top, so a
// plain scrollTo on mount is undone and one made after the sheet settles shows as a visible jump.
// These handlers wrap the library's defaults: setting the target scrolls there on the UI thread, and
// the lock is told to hold that offset instead of the top. Both run on the UI thread, so the scroll
// event can never be handled before the target is known.
import { useCallback } from 'react';
import { scrollTo, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { useScrollEventsHandlersDefault, type ScrollEventsHandlersHookType } from '@gorhom/bottom-sheet';

export function createInitialScrollHandlersHook(targetOffsetY: SharedValue<number>): ScrollEventsHandlersHookType {
    return (scrollableRef, scrollableContentOffsetY) => {
        const defaults = useScrollEventsHandlersDefault(scrollableRef, scrollableContentOffsetY);
        const handleOnScroll = defaults.handleOnScroll;

        useAnimatedReaction(() => targetOffsetY.value, (target, previous) => {
            if (target > 0 && target !== previous) {
                // @ts-ignore — the library's scrollable ref is an animated ref, as its own handlers use it
                scrollTo(scrollableRef, 0, target, false);
            }
        }, [scrollableRef]);

        const handleOnScrollWithInitialOffset = useCallback((payload: Parameters<NonNullable<typeof handleOnScroll>>[0], context: any) => {
            'worklet';
            const target = targetOffsetY.value;
            if (target > 0 && !context.initialScrollApplied) {
                context.initialScrollApplied = true;
                context.shouldLockInitialPosition = true;
                context.initialContentOffsetY = target;
            }
            handleOnScroll?.(payload, context as never);
        }, [handleOnScroll]);

        return { ...defaults, handleOnScroll: handleOnScrollWithInitialOffset };
    };
}
