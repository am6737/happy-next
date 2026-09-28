import * as React from 'react';
import { Platform, type ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import type { SharedValue } from 'react-native-reanimated';
import { COMPOSER_MARGIN } from './floatingComposer';

export type ChatScrollViewProps = ScrollViewProps & {
    /** Where the composer's padding ends above the bottom of the screen, which the keyboard offset is measured from. */
    bottomInset: number;
    /** How far the header reaches over the list, which the scroll indicator has to clear. */
    topInset?: number;
    /** The height of a composer floating over the list, kept clear of the scroll range. */
    composerInset?: SharedValue<number>;
};

/**
 * The scroll view under a chat list (`renderScrollComponent`). Lifts the list's content natively
 * with the keyboard instead of shrinking its frame, so the list's top edge (and the header effect
 * drawn over it) stays put while the composer rides the keyboard.
 */
export const ChatScrollView = React.forwardRef<React.ElementRef<typeof KeyboardChatScrollView>, ChatScrollViewProps>(
    ({ bottomInset, topInset = 0, composerInset, ...props }, ref) => (
        <KeyboardChatScrollView
            ref={ref}
            extraContentPadding={composerInset}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            // The indicator's bottom inset already runs to the composer's top (keyboard + composer, the
            // composer's height taking in the home indicator); UIKit's own safe-area adjustment would
            // stack the home indicator on it a second time. Its top clears the header instead.
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollIndicatorInsets={{ top: topInset }}
            keyboardDismissMode="interactive"
            keyboardLiftBehavior="always"
            offset={Platform.OS === 'ios' ? bottomInset - COMPOSER_MARGIN : bottomInset}
            {...props}
        />
    ),
);
ChatScrollView.displayName = 'ChatScrollView';
