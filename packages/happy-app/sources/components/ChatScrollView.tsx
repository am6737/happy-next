import * as React from 'react';
import { Platform, type ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, KeyboardController } from 'react-native-keyboard-controller';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { COMPOSER_MARGIN } from './floatingComposer';

export type ChatScrollViewProps = ScrollViewProps & {
    /** Where the composer's padding ends above the bottom of the screen, which the keyboard offset is measured from. */
    bottomInset: number;
    /** How far the header reaches over the list, which the scroll indicator has to clear. */
    topInset?: number;
    /** The height of a composer floating over the list, kept clear of the scroll range. */
    composerInset?: SharedValue<number>;
    /** The list scrolling in it, told how much of its bottom the composer covers. */
    listRef: React.RefObject<Pick<LegendListRef, 'reportContentInset'> | null>;
};

/** How much of the keyboard's height `ChatScrollView` leaves out of the lift (the part below the composer's padding). */
function keyboardOffset(bottomInset: number): number {
    return Platform.OS === 'ios' ? bottomInset - COMPOSER_MARGIN : bottomInset;
}

/**
 * How far the keyboard lifts the content of a `ChatScrollView` with this `bottomInset` right now.
 * The list only knows the composer's share of the bottom inset (see `reportComposerInset`), so its
 * `scrollToEnd` stops this far above the end while the keyboard is up; pass it as a negative
 * `viewOffset` to reach the end.
 */
export function chatKeyboardLift(bottomInset: number): number {
    return Math.max(0, KeyboardController.state().height - keyboardOffset(bottomInset));
}

/**
 * The scroll view under a chat list (`renderScrollComponent`). Lifts the list's content natively
 * with the keyboard instead of shrinking its frame, so the list's top edge (and the header effect
 * drawn over it) stays put while the composer rides the keyboard.
 */
export const ChatScrollView = React.forwardRef<React.ElementRef<typeof KeyboardChatScrollView>, ChatScrollViewProps>(
    ({ bottomInset, topInset = 0, composerInset, listRef, ...props }, ref) => {
        // The list only reads the insets off scroll events otherwise, so until the first one it
        // bottom-aligns a short chat as if the composer took no room, and that chat scrolls.
        // Only the composer is reported: the keyboard's share changes every frame while it moves,
        // and the list re-aligning to it from JS fights the native lift (`scrollTo`) above.
        const reportComposerInset = React.useCallback(
            (bottom: number) => listRef.current?.reportContentInset({ bottom }),
            [listRef],
        );
        useAnimatedReaction(
            () => composerInset?.value ?? 0,
            (bottom, previous) => {
                if (bottom !== previous) {
                    runOnJS(reportComposerInset)(bottom);
                }
            },
            [composerInset, reportComposerInset],
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
