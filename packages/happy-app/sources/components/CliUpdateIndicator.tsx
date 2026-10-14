import * as React from 'react';
import { ActivityIndicator, Platform, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { MachineCliUpdate } from '@/utils/cliUpdate';
import { StatusDot } from './StatusDot';
import { t } from '@/text';

/** What the indicator says, for its tooltip and accessibility label. Empty with no update. */
export function cliUpdateLabel(update: MachineCliUpdate): string {
    switch (update.state) {
        case 'available': return t('cliUpdate.bannerAvailable', { version: update.version });
        case 'installing': return t('cliUpdate.bannerInstalling', { version: update.version });
        case 'failed': return t('cliUpdate.bannerFailed');
        default: return '';
    }
}

/** The color of a CLI update: a new version, an install running, or one that failed. */
export function useCliUpdateColor(update: MachineCliUpdate): string {
    const { theme } = useUnistyles();
    return update.state === 'failed' ? theme.colors.box.error.text
        : update.state === 'available' ? theme.colors.box.warning.text
        : theme.colors.textSecondary;
}

/** A machine's CLI update as an icon: a new version, an install running, or one that failed. */
export const CliUpdateIcon = React.memo(({ update, size }: { update: MachineCliUpdate; size: number }) => {
    const color = useCliUpdateColor(update);
    switch (update.state) {
        case 'available':
            return <Ionicons name="arrow-up-circle-outline" size={size} color={color} />;
        case 'installing':
            return <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 16 as any} color={color} />;
        case 'failed':
            return <Ionicons name="alert-circle-outline" size={size} color={color} />;
        default:
            return null;
    }
});

/** The same update as a badge dot on another button, pulsing while the install runs. */
export const CliUpdateDot = React.memo(({ update, size = 8, style }: { update: MachineCliUpdate; size?: number; style?: ViewStyle }) => {
    const color = useCliUpdateColor(update);
    if (update.state === 'none') return null;
    return <StatusDot color={color} isPulsing={update.state === 'installing'} size={size} style={style} />;
});

/** A ref that shows `label` as the browser tooltip of the element (web only). */
export function webTitle(label: string) {
    return (element: any) => {
        if (Platform.OS === 'web' && element && typeof element === 'object') element.title = label;
    };
}
