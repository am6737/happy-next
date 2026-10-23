import * as React from 'react';
import { BottomSheetModal, BottomSheetBackdrop, type BottomSheetBackdropProps, type BottomSheetModalProps } from '@gorhom/bottom-sheet';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { sheetSideMargin } from './glassSheet';

const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
);

/**
 * The app's bottom sheet: every sheet looks and behaves the same, so each one only says how tall
 * it is and what it holds. Drawn on the grouped background, with white for what sits on it
 * (search boxes, chips, pressed rows). With the keyboard up, a sheet holding a search box rises
 * as far as it can, but not under the status bar, and settles back when the keyboard goes. On a
 * wide window (desktop, tablet) it is centered at the width of the other bottom sheets.
 */
export const AppBottomSheet = React.forwardRef<BottomSheetModal, BottomSheetModalProps>((props, ref) => {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const background = theme.colors.groupped.background;
    const handle = theme.colors.textSecondary;
    const backgroundStyle = React.useMemo(() => ({ backgroundColor: background }), [background]);
    const handleIndicatorStyle = React.useMemo(() => ({ backgroundColor: handle }), [handle]);
    const sideMargin = sheetSideMargin(windowWidth);
    const style = React.useMemo(() => [{ marginHorizontal: sideMargin }, props.style], [sideMargin, props.style]);
    return (
        <BottomSheetModal
            ref={ref}
            topInset={safeArea.top}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            backdropComponent={renderBackdrop}
            backgroundStyle={backgroundStyle}
            handleIndicatorStyle={handleIndicatorStyle}
            {...props}
            style={style}
        />
    );
});
