import * as React from 'react';
import { Platform, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export type KeyboardDockProps = ViewProps & {
    /** How far the dock's bottom may sit below the keyboard's top once the keyboard is up. */
    keyboardOffset: number;
};

/**
 * A composer dock that UIKit lifts over the keyboard with `keyboardLayoutGuide`, instead of a
 * transform from JS, and that carries the iOS 26 bottom scroll edge effect under it
 * (`modules/scroll-edge-element`). `null` where the native view is missing (a binary built before
 * it was added, or another platform): callers fall back to `KeyboardStickyView`.
 */
export const KeyboardDock: React.ComponentType<KeyboardDockProps> | null =
    Platform.OS === 'ios' && requireOptionalNativeModule('KeyboardDock')
        ? requireNativeViewManager('KeyboardDock')
        : null;
