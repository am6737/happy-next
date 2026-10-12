import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { resolveTerminalTheme } from '@/terminal/terminalTheme';

/** The terminal palette for the app's current light or dark theme. */
export function useTerminalTheme() {
    const { rt } = useUnistyles();
    const systemScheme = useColorScheme();
    const scheme = rt.themeName === 'light' || rt.themeName === 'dark' ? rt.themeName : systemScheme ?? 'dark';
    return useMemo(() => resolveTerminalTheme(scheme), [scheme]);
}
