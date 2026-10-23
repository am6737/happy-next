import * as React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAllMachines, useAllSessions } from '@/sync/storage';
import { loadThemePreference } from '@/sync/persistence';
import { darkTheme, lightTheme } from '@/theme';
import { getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';
import { setShareExtensionSnapshot } from '@/share/shareExtension';
import { t } from '@/text';

// The extension's sheet takes up to 10 of each (iosActivationRules in app.config.js)
const MAX_SHARED = 10;

// A session's mark in the sheet: the letter and colour of its agent
const FLAVORS: Record<string, { letter: string; color: string }> = {
    claude: { letter: 'C', color: '#D97757' },
    codex: { letter: 'X', color: '#10A37F' },
    openai: { letter: 'X', color: '#10A37F' },
    gpt: { letter: 'X', color: '#10A37F' },
    gemini: { letter: 'G', color: '#4285F4' },
    qoder: { letter: 'Q', color: '#7C5CFC' },
};

/** #RRGGBB or #RRGGBBAA, the forms the extension reads, from the theme's #RGB, #RRGGBB or rgba(). */
function toHex(color: string): string {
    const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (rgba) {
        const byte = (value: number) => Math.round(value).toString(16).padStart(2, '0');
        const alpha = rgba[4] === undefined ? '' : byte(Number(rgba[4]) * 255);
        return `#${byte(Number(rgba[1]))}${byte(Number(rgba[2]))}${byte(Number(rgba[3]))}${alpha}`.toUpperCase();
    }
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color.slice(1).split('').map((digit) => digit + digit).join('')}`.toUpperCase();
    }
    return color.toUpperCase();
}

function palette(theme: typeof lightTheme) {
    const colors = theme.colors;
    return {
        background: toHex(colors.groupped.background),
        field: toHex(colors.surface),
        text: toHex(colors.text),
        textSecondary: toHex(colors.textSecondary),
        divider: toHex(colors.divider),
        pressed: toHex(colors.sessionList.rowHover),
        tint: toHex(colors.header.tint),
        accent: toHex(colors.button.primary.background),
        accentTint: toHex(colors.button.primary.tint),
        online: toHex(colors.status.connected),
    };
}

function counts(format: (count: number) => string): string[] {
    return Array.from({ length: MAX_SHARED }, (_, index) => format(index + 1));
}

/**
 * Keeps the iOS share extension's snapshot up to date: the online sessions it lists (the same as
 * the share-target page), its strings in the app's language and the app's colours. The extension
 * can't reach the app's store, so it reads this from the App Group; signed out there is none, and
 * the extension just opens the app. Written only when it changes.
 */
export function useShareExtensionSnapshot(enabled: boolean) {
    const allSessions = useAllSessions();
    const machines = useAllMachines();
    const lastWritten = React.useRef<string | null | undefined>(undefined);

    const json = React.useMemo(() => {
        if (Platform.OS !== 'ios' || !enabled) return null;
        const machineNames = new Map(machines.map((machine) => [
            machine.id,
            machine.metadata?.displayName || machine.metadata?.host || '',
        ]));
        const sessions = allSessions
            .filter((session) => session.active && !session.accessLevel)
            .map((session) => {
                const machine = machineNames.get(session.metadata?.machineId ?? '');
                const flavor = FLAVORS[session.metadata?.flavor ?? 'claude'] ?? {
                    letter: (session.metadata?.flavor?.[0] ?? '?').toUpperCase(),
                    color: '#8E8E93',
                };
                return {
                    id: session.id,
                    name: getSessionName(session),
                    subtitle: [getSessionSubtitle(session), machine].filter(Boolean).join(' · '),
                    ...flavor,
                };
            });
        return JSON.stringify({
            appearance: loadThemePreference(),
            light: palette(lightTheme),
            dark: palette(darkTheme),
            strings: {
                title: t('shareTarget.sheetTitle', { app: Constants.expoConfig?.name ?? 'Happy' }),
                cancel: t('common.cancel'),
                searchPlaceholder: t('shareTarget.searchPlaceholder'),
                newSession: t('shareTarget.newSession'),
                activeSessions: t('shareTarget.activeSessions'),
                noActiveSessions: t('shareTarget.noActiveSessions'),
                noResults: t('shareTarget.noResults'),
                text: t('shareTarget.text'),
                images: counts((count) => t('shareTarget.images', { count })),
                videos: counts((count) => t('shareTarget.videos', { count })),
                files: counts((count) => t('shareTarget.files', { count })),
            },
            sessions,
        });
    }, [enabled, allSessions, machines]);

    React.useEffect(() => {
        if (Platform.OS !== 'ios' || json === lastWritten.current) return;
        lastWritten.current = json;
        setShareExtensionSnapshot(json);
    }, [json]);
}
