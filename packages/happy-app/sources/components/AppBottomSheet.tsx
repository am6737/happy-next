import * as React from 'react';
import { BottomSheetModal, BottomSheetBackdrop, type BottomSheetBackdropProps, type BottomSheetBackgroundProps, type BottomSheetModalProps } from '@gorhom/bottom-sheet';
import { GlassView } from 'expo-glass-effect';
import { useWindowDimensions } from 'react-native';
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

export type AppBottomSheetProps = BottomSheetModalProps & {
    /**
     * On iOS 26, a Liquid Glass card floating clear of the screen's edges, like the other bottom
     * sheets (see `glassSheet`). What sits on it takes `GLASS_SHEET_FILL` instead of white, which
     * would cover the glass, and leaves out the home indicator's inset: the card sits above it.
     */
    glass?: boolean;
};

/**
 * The app's bottom sheet: every sheet looks and behaves the same, so each one only says how tall
 * it is and what it holds. Drawn on the grouped background, with white for what sits on it
 * (search boxes, chips, pressed rows). With the keyboard up, a sheet holding a search box rises
 * as far as it can, but not under the status bar, and settles back when the keyboard goes. On a
 * wide window (desktop, tablet) it is centered at the width of the other bottom sheets.
 */
export const AppBottomSheet = React.forwardRef<BottomSheetModal, AppBottomSheetProps>(({ glass: glassProp, ...props }, ref) => {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const glass = glassProp === true && liquidGlassAvailable;
    const background = theme.colors.groupped.background;
    const handle = theme.colors.textSecondary;
    const backgroundStyle = React.useMemo(() => ({ backgroundColor: background }), [background]);
    const handleIndicatorStyle = React.useMemo(() => ({ backgroundColor: handle }), [handle]);
    const sideMargin = sheetSideMargin(windowWidth, glass ? GLASS_SHEET_MARGIN : 0);
    const style = React.useMemo(() => [{ marginHorizontal: sideMargin }, props.style], [sideMargin, props.style]);
    const glassProps = glass ? {
        detached: true,
        bottomInset: glassSheetFramePadding(safeArea.bottom).paddingBottom,
        backdropComponent: renderGlassBackdrop,
        backgroundComponent: GlassBackground,
    } : null;
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
            {...glassProps}
            {...props}
            style={style}
        />
    );
});
