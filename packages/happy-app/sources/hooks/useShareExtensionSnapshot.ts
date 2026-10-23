import * as React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { useAllMachines, useAllSessions, useSetting } from '@/sync/storage';
import { loadThemePreference } from '@/sync/persistence';
import { darkTheme, lightTheme } from '@/theme';
import { getSessionAvatarId, getSessionName } from '@/utils/sessionUtils';
import { brutalistAvatar } from '@/components/AvatarBrutalist';
import { gradientAvatar } from '@/components/AvatarGradient';
import { pixelAvatarColors } from '@/components/AvatarSkia';
import { setShareExtensionSnapshot } from '@/share/shareExtension';
import { t } from '@/text';

// The extension's sheet takes up to 10 of each (iosActivationRules in app.config.js)
const MAX_SHARED = 10;

// The agent's name under a session, as the new-session page names it
const AGENTS: Record<string, 'claude' | 'codex' | 'gemini' | 'qoder'> = {
    claude: 'claude',
    codex: 'codex',
    openai: 'codex',
    gpt: 'codex',
    gemini: 'gemini',
    qoder: 'qoder',
};

function agentName(flavor: string | null | undefined): string {
    const agent = AGENTS[flavor ?? 'claude'];
    if (agent) return t(`agentInput.agent.${agent}`);
    return flavor ? flavor[0].toUpperCase() + flavor.slice(1) : '';
}

// Where the avatars' images go in the App Group, for the extension to read
const AVATARS_DIR = 'share-avatars';

/**
 * A session's avatar as the extension draws it, without the badges: the image (copied into the
 * App Group under this name) on its background, tinted, at its scale; or the pixel style's 8×8
 * cells. Picked the way Avatar does for the avatar style setting.
 */
function avatarSpec(id: string, style: string) {
    if (style === 'pixelated') {
        return { spec: { pixels: pixelAvatarColors(id) }, image: null };
    }
    if (style === 'brutalist') {
        const light = brutalistAvatar(id, false);
        const dark = brutalistAvatar(id, true);
        const image = { name: `brutalist-${light.imageIndex}.png`, source: light.imageSource };
        return {
            spec: {
                image: image.name,
                imageScale: 0.8,
                tint: { light: light.colorPair.tint, dark: dark.colorPair.tint },
                background: { light: light.colorPair.background, dark: dark.colorPair.background },
            },
            image,
        };
    }
    const gradient = gradientAvatar(id);
    const image = { name: `gradient-${gradient.imageIndex}.png`, source: gradient.imageSource };
    return { spec: { image: image.name, imageScale: 1 }, image };
}

/** Copies the avatars' images the App Group doesn't have yet; false when it can't be reached. */
async function copyAvatarImages(images: Map<string, number>): Promise<boolean> {
    const container = Object.entries(Paths.appleSharedContainers).find(([group]) => group.startsWith('group.'))?.[1];
    if (!container) return false;
    const dir = new Directory(container, AVATARS_DIR);
    if (!dir.exists) dir.create({ intermediates: true });
    for (const [name, source] of images) {
        const target = new File(dir, name);
        if (target.exists) continue;
        const asset = await Asset.fromModule(source).downloadAsync();
        new File(asset.localUri ?? asset.uri).copy(target);
    }
    return true;
}

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
    const avatarStyle = useSetting('avatarStyle');
    const lastWritten = React.useRef<string | null | undefined>(undefined);

    const snapshot = React.useMemo(() => {
        if (Platform.OS !== 'ios' || !enabled) return null;
        const images = new Map<string, number>();
        const machineNames = new Map(machines.map((machine) => [
            machine.id,
            machine.metadata?.displayName || machine.metadata?.host || '',
        ]));
        const sessions = allSessions
            .filter((session) => session.active && !session.accessLevel)
            .map((session) => {
                const path = session.metadata?.path ?? '';
                const project = path.split(/[\\/]/).filter(Boolean).pop() ?? '';
                const machine = machineNames.get(session.metadata?.machineId ?? '');
                const avatar = avatarSpec(getSessionAvatarId(session), avatarStyle);
                if (avatar.image) images.set(avatar.image.name, avatar.image.source);
                return {
                    id: session.id,
                    name: getSessionName(session),
                    subtitle: [project, agentName(session.metadata?.flavor), machine].filter(Boolean).join(' · '),
                    avatar: avatar.spec,
                };
            });
        const json = JSON.stringify({
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
        return { json, images };
    }, [enabled, allSessions, machines, avatarStyle]);

    React.useEffect(() => {
        const json = snapshot?.json ?? null;
        if (Platform.OS !== 'ios' || json === lastWritten.current) return;
        lastWritten.current = json;
        if (!snapshot) {
            setShareExtensionSnapshot(null);
            return;
        }
        // The images go first, so the sheet finds those the snapshot names (one it can't read is
        // drawn as a plain circle); a newer snapshot by then is written in its place
        copyAvatarImages(snapshot.images)
            .catch((error) => console.warn('[ShareExtension] avatars', error))
            .finally(() => {
                if (lastWritten.current === json) setShareExtensionSnapshot(json);
            });
    }, [snapshot]);
}
