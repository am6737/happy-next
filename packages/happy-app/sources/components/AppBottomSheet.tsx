import * as React from 'react';
import { BottomSheetModal, BottomSheetBackdrop, type BottomSheetBackdropProps, type BottomSheetBackgroundProps, type BottomSheetModalProps } from '@gorhom/bottom-sheet';
import { GlassView } from 'expo-glass-effect';
import { useWindowDimensions } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { liquidGlassAvailable } from './GlassSurface';
import { GLASS_SHEET_MARGIN, GLASS_SHEET_RADIUS, glassSheetFramePadding, SHEET_BACKDROP_OPACITY, sheetSideMargin } from './glassSheet';

const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
);

const renderGlassBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" opacity={SHEET_BACKDROP_OPACITY} />
);

// The sheet's own background color is left out: an opaque fill would cover the glass.
const GlassBackground = ({ pointerEvents, style }: BottomSheetBackgroundProps) => (
    <GlassView pointerEvents={pointerEvents} glassEffectStyle="regular" style={[style, glassBackgroundStyle]} />
);
const glassBackgroundStyle = { backgroundColor: 'transparent', borderRadius: GLASS_SHEET_RADIUS };

/**
 * The app's bottom sheet: every sheet looks and behaves the same, so each one only says how tall
 * it is and what it holds. Drawn on the grouped background, with white for what sits on it
 * (search boxes, chips, pressed rows). On iOS 26 it is a Liquid Glass card floating clear of the
 * screen's edges, like the other bottom sheets (see `glassSheet`): what sits on it takes
 * `sheetFill`, as white would cover the glass, and leaves the home indicator's inset out through
 * `sheetSafeAreaBottom`, as the card sits above it. With the keyboard up, a sheet holding a search box rises
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
    const sideMargin = sheetSideMargin(windowWidth, liquidGlassAvailable ? GLASS_SHEET_MARGIN : 0);
    // The sheet lifts to the keyboard's top edge with nothing between, the room under it
    // (`bottomInset`) being taken off the lift; the glass card stays clear of the floating keyboard
    // by its margin, as the schedule-message sheet does, rising the rest of the way with it. The
    // body's position is the sheet's own transform, so this moves it by its margin instead.
    const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
    const keyboardGapStyle = useAnimatedStyle(() => (
        liquidGlassAvailable ? { marginTop: -GLASS_SHEET_MARGIN * keyboardProgress.value } : {}
    ));
    const style = React.useMemo(
        () => [{ marginHorizontal: sideMargin }, keyboardGapStyle, props.style],
        [sideMargin, keyboardGapStyle, props.style],
    );
    const glassProps = liquidGlassAvailable ? {
        detached: true,
        bottomInset: glassSheetFramePadding(safeArea.bottom).paddingBottom,
        backdropComponent: renderGlassBackdrop,
        backgroundComponent: GlassBackground,
    } : null;
    return (
        <BottomSheetModal
            ref={ref}
            // Glass leaves room for the keyboard gap, so a sheet lifted all the way stays under the status bar.
            topInset={safeArea.top + (liquidGlassAvailable ? GLASS_SHEET_MARGIN : 0)}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            backdropComponent={renderBackdrop}
            backgroundStyle={backgroundStyle}
            handleIndicatorStyle={handleIndicatorStyle}
            {...glassProps}
            {...props}
            style={style}
        />
    );
});
