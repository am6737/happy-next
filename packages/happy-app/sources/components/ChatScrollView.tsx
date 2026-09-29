import * as React from 'react';
import { Platform, type ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS, useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { COMPOSER_MARGIN } from './floatingComposer';

export type ChatScrollViewProps = ScrollViewProps & {
    /** Where the composer's padding ends above the bottom of the screen, which the keyboard offset is measured from. */
    bottomInset: number;
    /** How far the header reaches over the list, which the scroll indicator has to clear. */
    topInset?: number;
    /** The height of a composer floating over the list, kept clear of the scroll range. */
    composerInset?: SharedValue<number>;
    /** The list scrolling in it, told how much of its bottom the composer and the keyboard cover. */
    listRef: React.RefObject<Pick<LegendListRef, 'reportContentInset'> | null>;
    /** Whether the list has let go of its initial end target (`useChatListSettled`); settled if left out. */
    listSettled?: SharedValue<boolean>;
};

/**
 * How long LegendList (3.4.0) keeps re-aligning to its initial end target after `onReady`
 * (`PRESERVED_INITIAL_SCROLL_FALLBACK_CLEAR_DELAY_MS`), plus a margin.
 */
const INITIAL_END_TARGET_MS = 2200;

/**
 * Tells `ChatScrollView` when the list is done placing itself: pass `onReady` to the list and
 * `listSettled` to the scroll view. For a while after the list is ready it keeps pulling back to
 * its initial end target whenever the reported inset changes, and it measures that pull from the
 * last native offset: the keyboard's share arriving then, in a short chat, gets pulled from the
 * offset the keyboard lifted it to, which the shrinking end space is about to undo, and the
 * message flashes out of place.
 */
export function useChatListSettled(): { listSettled: SharedValue<boolean>; onReady: () => void } {
    const listSettled = useSharedValue(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const onReady = React.useCallback(() => {
        listSettled.value = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            listSettled.value = true;
        }, INITIAL_END_TARGET_MS);
    }, [listSettled]);
    React.useEffect(() => () => clearTimeout(timer.current), []);
    return { listSettled, onReady };
}

/** How much of the keyboard's height `ChatScrollView` leaves out of the lift (the part below the composer's padding). */
function keyboardOffset(bottomInset: number): number {
    return Platform.OS === 'ios' ? bottomInset - COMPOSER_MARGIN : bottomInset;
}

/**
 * The scroll view under a chat list (`renderScrollComponent`). Lifts the list's content natively
 * with the keyboard instead of shrinking its frame, so the list's top edge (and the header effect
 * drawn over it) stays put while the composer rides the keyboard.
 */
export const ChatScrollView = React.forwardRef<React.ElementRef<typeof KeyboardChatScrollView>, ChatScrollViewProps>(
    ({ bottomInset, topInset = 0, composerInset, listRef, listSettled, ...props }, ref) => {
        // The list only reads the insets off scroll events otherwise, so until the first one it
        // bottom-aligns a short chat as if the composer took no room, and that chat scrolls.
        // The reported inset replaces the native one, so it has to take in the keyboard too, or
        // following new messages to the end stops where the end was with the keyboard down. The
        // keyboard's share is only reported once it settles: it changes every frame while the
        // keyboard moves, and the list re-aligning to it from JS fights the native lift.
        // Closing is the exception: a short chat already sits at offset 0, so nothing native
        // brings it down, and it would hang in the air until the keyboard was gone.
        // Until the list settles (`useChatListSettled`) the keyboard's share is held back; the
        // native lift covers it meanwhile.
        const offset = keyboardOffset(bottomInset);
        const keyboardLift = useSharedValue(0);
        const keyboardClosing = useSharedValue(false);
        useKeyboardHandler(
            {
                onStart: (e) => {
                    'worklet';
                    keyboardClosing.value = e.height - offset < keyboardLift.value;
                },
                onMove: (e) => {
                    'worklet';
                    if (keyboardClosing.value) {
                        keyboardLift.value = Math.min(keyboardLift.value, Math.max(0, e.height - offset));
                    }
                },
                onEnd: (e) => {
                    'worklet';
                    keyboardClosing.value = false;
                    keyboardLift.value = Math.max(0, e.height - offset);
                },
            },
            [offset],
        );
        const reportBottomInset = React.useCallback(
            (bottom: number) => listRef.current?.reportContentInset({ bottom }),
            [listRef],
        );
        useAnimatedReaction(
            () => (composerInset?.value ?? 0) + (listSettled?.value === false ? 0 : keyboardLift.value),
            (bottom, previous) => {
                if (bottom !== previous) {
                    runOnJS(reportBottomInset)(bottom);
                }
            },
            [composerInset, listSettled, reportBottomInset],
        );
        return (
            <KeyboardChatScrollView
                ref={ref}
                extraContentPadding={composerInset}
                // A chat that fits does not move under the finger.
                alwaysBounceVertical={false}
                automaticallyAdjustContentInsets={false}
                contentInsetAdjustmentBehavior="never"
                // The indicator's bottom inset already runs to the composer's top (keyboard + composer, the
                // composer's height taking in the home indicator); UIKit's own safe-area adjustment would
                // stack the home indicator on it a second time. Its top clears the header instead.
                automaticallyAdjustsScrollIndicatorInsets={false}
                scrollIndicatorInsets={{ top: topInset }}
                keyboardDismissMode="interactive"
                keyboardLiftBehavior="always"
                offset={keyboardOffset(bottomInset)}
                {...props}
            />
        );
    },
);
ChatScrollView.displayName = 'ChatScrollView';
