import * as React from 'react';
import { Pressable, Text } from 'react-native';

import { t } from '@/text';
import {
    getDesktopUpdateSnapshot,
    installDesktopUpdateAndRelaunch,
    subscribeToDesktopUpdate,
} from './desktopUpdater';

type DesktopUpdateButtonProps = {
    placement: 'titleBar' | 'floating';
};

export function DesktopUpdateButton({ placement }: DesktopUpdateButtonProps) {
    const update = React.useSyncExternalStore(
        subscribeToDesktopUpdate,
        getDesktopUpdateSnapshot,
        getDesktopUpdateSnapshot,
    );
    const installing = update.phase === 'installing';

    if (update.phase !== 'downloaded' && update.phase !== 'installError' && !installing) {
        return null;
    }

    const label = t('desktopUpdate.apply');
    const versionHint = update.availableVersion
        ? t('desktopUpdate.available', { version: update.availableVersion })
        : label;

    return (
        <Pressable
            {...({ 'data-desktop-no-drag': true } as any)}
            accessibilityLabel={label}
            accessibilityHint={versionHint}
            accessibilityRole="button"
            disabled={installing}
            onPress={() => void installDesktopUpdateAndRelaunch()}
            ref={(element: any) => {
                if (element && typeof element === 'object') {
                    element.title = versionHint;
                }
            }}
            style={({ hovered, pressed }: any) => ({
                alignItems: 'center',
                alignSelf: placement === 'floating' ? 'flex-end' : 'center',
                backgroundColor: hovered || pressed ? '#0067D9' : '#007AFF',
                borderRadius: 7,
                height: placement === 'floating' ? 30 : 26,
                justifyContent: 'center',
                marginLeft: placement === 'titleBar' ? 6 : 0,
                minWidth: placement === 'floating' ? 54 : 48,
                opacity: installing ? 0.65 : 1,
                paddingHorizontal: placement === 'floating' ? 14 : 10,
            })}
        >
            <Text
                selectable={false}
                style={{
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: '600',
                    lineHeight: 18,
                }}
            >
                {label}
            </Text>
        </Pressable>
    );
}
