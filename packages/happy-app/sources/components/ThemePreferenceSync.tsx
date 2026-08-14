import * as React from 'react';
import { Appearance, Platform } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { UnistylesRuntime } from 'react-native-unistyles';

import { useLocalSetting } from '@/sync/storage';
import { darkTheme, lightTheme } from '@/theme';
import { setAppColorScheme } from '@/utils/setAppColorScheme';

type ThemePreference = 'light' | 'dark' | 'adaptive';

function syncWebBootstrapTheme(preference: ThemePreference) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
        return;
    }

    if (preference === 'adaptive') {
        document.documentElement.removeAttribute('data-happy-bootstrap-theme');
        return;
    }

    document.documentElement.setAttribute('data-happy-bootstrap-theme', preference);
}

function applyRootBackground(colorScheme: 'light' | 'dark' | null | undefined) {
    const color = colorScheme === 'dark'
        ? darkTheme.colors.groupped.background
        : lightTheme.colors.groupped.background;

    UnistylesRuntime.setRootViewBackgroundColor(color);
    void SystemUI.setBackgroundColorAsync(color);
}

export function ThemePreferenceSync() {
    const themePreference = useLocalSetting('themePreference');

    React.useLayoutEffect(() => {
        syncWebBootstrapTheme(themePreference);
        setAppColorScheme(themePreference === 'adaptive' ? null : themePreference);

        if (themePreference === 'adaptive') {
            UnistylesRuntime.setAdaptiveThemes(true);
            applyRootBackground(Appearance.getColorScheme());
            return;
        }

        UnistylesRuntime.setAdaptiveThemes(false);
        UnistylesRuntime.setTheme(themePreference);
        applyRootBackground(themePreference);
    }, [themePreference]);

    React.useEffect(() => {
        if (themePreference !== 'adaptive') {
            return;
        }

        const subscription = Appearance.addChangeListener(({ colorScheme }) => {
            applyRootBackground(colorScheme);
        });

        return () => subscription.remove();
    }, [themePreference]);

    return null;
}
