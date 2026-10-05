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
};

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
    ({ bottomInset, topInset = 0, composerInset, listRef, ...props }, ref) => {
        // The list only reads the insets off scroll events otherwise, so until the first one it
        // measures its end as if the composer took no room, and the last message ends under it.
        // The reported inset replaces the native one, so it has to take in the keyboard too, or
        // following new messages to the end stops where the end was with the keyboard down. The
        // keyboard's share is only reported once it settles: it changes every frame while the
        // keyboard moves, and the list re-aligning to it from JS fights the native lift.
        const offset = keyboardOffset(bottomInset);
        const keyboardLift = useSharedValue(0);
        useKeyboardHandler(
            {
                onEnd: (e) => {
                    'worklet';
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
            () => (composerInset?.value ?? 0) + keyboardLift.value,
            (bottom, previous) => {
                if (bottom !== previous) {
                    runOnJS(reportBottomInset)(bottom);
                }
            },
            [composerInset, reportBottomInset],
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
