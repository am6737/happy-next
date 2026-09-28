import * as React from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

type ScrollEdgeElementContainerProps = ViewProps & {
    /** Which edge of the scroll view beside it this view floats over. */
    edge?: 'top' | 'bottom';
};

// The native view lives in `modules/scroll-edge-element`. A binary built before it was added has
// no such module, so fall back to a plain view there rather than failing to render.
const NativeScrollEdgeElement: React.ComponentType<ScrollEdgeElementContainerProps> | null =
    Platform.OS === 'ios' && requireOptionalNativeModule('ScrollEdgeElement')
        ? requireNativeViewManager('ScrollEdgeElement')
        : null;

/**
 * Registers its content as a floating element over the nearest scroll view, so iOS 26 draws that
 * scroll view's soft edge effect underneath it — the way it does under system bars. Renders a plain
 * view wherever that is unavailable.
 */
export const ScrollEdgeElementContainer = React.memo((props: ScrollEdgeElementContainerProps) => {
    if (!NativeScrollEdgeElement) {
        const { edge: _edge, ...viewProps } = props;
        return <View {...viewProps} />;
    }
    return <NativeScrollEdgeElement edge="bottom" {...props} />;
});
ScrollEdgeElementContainer.displayName = 'ScrollEdgeElementContainer';
