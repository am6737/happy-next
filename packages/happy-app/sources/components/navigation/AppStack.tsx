import * as React from 'react';
import { Stack as RouterStack } from 'expo-router';

type SubtitleOptions = {
    headerSubtitle?: string;
    headerSubtitleColor?: string;
};

type ExtendOptions<T> = T extends (...args: infer Args) => infer Result
    ? (...args: Args) => Result & SubtitleOptions
    : T & SubtitleOptions;

type ScreenProps = React.ComponentProps<typeof RouterStack.Screen>;
type AppScreenProps = Omit<ScreenProps, 'options'> & {
    options?: ExtendOptions<NonNullable<ScreenProps['options']>>;
};

// The app's Header reads these extra options; Expo Router still owns the screen at runtime.
export const Stack = RouterStack as Omit<typeof RouterStack, 'Screen'> & {
    Screen: React.ComponentType<AppScreenProps>;
};
