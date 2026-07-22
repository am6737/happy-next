import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { getDesktopPlatform } from './desktopWindowUtils';

const WINDOWS_TITLE_BAR_HEIGHT = 40;
const WINDOWS_CONTROL_WIDTH = 46;
const MACOS_RIGHT_DRAG_STRIP_LEFT = 360;

type WindowControlProps = {
    accessibilityLabel: string;
    destructive?: boolean;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    onPress: () => void;
};

function WindowControl({ accessibilityLabel, destructive, icon, onPress }: WindowControlProps) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);

    return (
        <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            onPress={onPress}
            style={({ pressed }) => ({
                alignItems: 'center',
                backgroundColor: destructive && hovered
                    ? '#E81123'
                    : hovered || pressed
                        ? theme.colors.surfacePressed
                        : 'transparent',
                height: WINDOWS_TITLE_BAR_HEIGHT,
                justifyContent: 'center',
                width: WINDOWS_CONTROL_WIDTH,
            })}
        >
            <MaterialCommunityIcons
                color={destructive && hovered ? '#FFFFFF' : theme.colors.text}
                name={icon}
                size={16}
            />
        </Pressable>
    );
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
    const { theme } = useUnistyles();
    const desktopPlatform = getDesktopPlatform();
    const [maximized, setMaximized] = React.useState(false);

    React.useEffect(() => {
        if (desktopPlatform !== 'windows') {
            return;
        }

        const window = getCurrentWindow();
        let mounted = true;
        let unlisten: (() => void) | undefined;

        const updateMaximized = async () => {
            const value = await window.isMaximized();
            if (mounted) {
                setMaximized(value);
            }
        };

        void updateMaximized();
        void window.onResized(() => {
            void updateMaximized();
        }).then((cleanup) => {
            unlisten = cleanup;
        });

        return () => {
            mounted = false;
            unlisten?.();
        };
    }, [desktopPlatform]);

    if (!desktopPlatform) {
        return <>{children}</>;
    }

    const window = getCurrentWindow();
    const isMacOS = desktopPlatform === 'macos';

    if (isMacOS) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
                {children}
                <View
                    {...({ 'data-tauri-drag-region': true } as any)}
                    style={{
                        height: 8,
                        left: MACOS_RIGHT_DRAG_STRIP_LEFT,
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        zIndex: 1000,
                    }}
                />
            </View>
        );
    }

    const titleBarHeight = WINDOWS_TITLE_BAR_HEIGHT;

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
            <View
                {...({
                    onDoubleClick: () => {
                        void window.toggleMaximize();
                    },
                } as any)}
                {...({ 'data-tauri-drag-region': true } as any)}
                style={{
                    alignItems: 'center',
                    backgroundColor: theme.colors.header.background,
                    borderBottomColor: theme.colors.divider,
                    borderBottomWidth: 1,
                    flexDirection: 'row',
                    height: titleBarHeight,
                    userSelect: 'none',
                    zIndex: 1000,
                } as any}
            >
                <View
                    {...({ 'data-tauri-drag-region': true } as any)}
                    style={{ flex: 1, height: titleBarHeight }}
                />
                <View style={{ flexDirection: 'row', height: titleBarHeight }}>
                    <WindowControl
                        accessibilityLabel="Minimize window"
                        icon="window-minimize"
                        onPress={() => void window.minimize()}
                    />
                    <WindowControl
                        accessibilityLabel={maximized ? 'Restore window' : 'Maximize window'}
                        icon={maximized ? 'window-restore' : 'window-maximize'}
                        onPress={() => void window.toggleMaximize()}
                    />
                    <WindowControl
                        accessibilityLabel="Close window"
                        destructive
                        icon="window-close"
                        onPress={() => void window.close()}
                    />
                </View>
            </View>
            <View style={{ flex: 1 }}>
                {children}
            </View>
        </View>
    );
}
