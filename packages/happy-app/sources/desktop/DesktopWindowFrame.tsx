import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/AuthContext';
import { DesktopUpdateButton } from './DesktopUpdateButton';
import { getDesktopPlatform, handleDesktopTitleBarMouseDown } from './desktopWindowUtils';

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
    const [focused, setFocused] = React.useState(false);

    return (
        <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onBlur={() => setFocused(false)}
            onFocus={() => setFocused(true)}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            onPress={onPress}
            style={({ pressed }) => ({
                alignItems: 'center',
                backgroundColor: destructive && hovered
                    ? '#E81123'
                    : hovered || pressed || focused
                        ? theme.colors.surfacePressed
                        : 'transparent',
                height: WINDOWS_TITLE_BAR_HEIGHT,
                justifyContent: 'center',
                outlineColor: focused ? theme.colors.textLink : 'transparent',
                outlineOffset: -2,
                outlineStyle: 'solid',
                outlineWidth: focused ? 2 : 0,
                width: WINDOWS_CONTROL_WIDTH,
            } as any)}
        >
            <MaterialCommunityIcons
                color={destructive && hovered ? '#FFFFFF' : theme.colors.text}
                name={icon}
                size={16}
            />
        </Pressable>
    );
}

function runWindowAction(action: () => Promise<void>): void {
    void action().catch((error) => {
        console.warn('Desktop window action failed:', error);
    });
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
    const { theme } = useUnistyles();
    const desktopPlatform = getDesktopPlatform();
    const { isAuthenticated } = useAuth();
    const [maximized, setMaximized] = React.useState(false);

    React.useEffect(() => {
        if (desktopPlatform !== 'windows') {
            return;
        }

        const window = getCurrentWindow();
        let mounted = true;
        let unlisten: (() => void) | undefined;

        const updateMaximized = async () => {
            try {
                const value = await window.isMaximized();
                if (mounted) {
                    setMaximized(value);
                }
            } catch (error) {
                console.warn('Failed to read desktop window state:', error);
            }
        };

        void updateMaximized();
        void window.onResized(() => {
            void updateMaximized();
        }).then((cleanup) => {
            unlisten = cleanup;
        }).catch((error) => console.warn('Failed to observe desktop window size:', error));

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
    const handleTitleBarMouseDown = (event: any) => {
        handleDesktopTitleBarMouseDown(event, { allowMaximize: isAuthenticated });
    };

    if (isMacOS) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
                {children}
                {!isAuthenticated && (
                    <View
                        pointerEvents="box-none"
                        style={{ bottom: 16, position: 'absolute', right: 16, zIndex: 1100 }}
                    >
                        <DesktopUpdateButton placement="floating" />
                    </View>
                )}
                <View
                    {...({
                        'data-tauri-drag-region': true,
                        onMouseDown: handleTitleBarMouseDown,
                    } as any)}
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
                    'data-tauri-drag-region': true,
                    onMouseDown: handleTitleBarMouseDown,
                } as any)}
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
                        onPress={() => runWindowAction(() => window.minimize())}
                    />
                    <WindowControl
                        accessibilityLabel={maximized ? 'Restore window' : 'Maximize window'}
                        icon={maximized ? 'window-restore' : 'window-maximize'}
                        onPress={() => runWindowAction(() => window.toggleMaximize())}
                    />
                    <WindowControl
                        accessibilityLabel="Close window"
                        destructive
                        icon="window-close"
                        onPress={() => runWindowAction(() => window.close())}
                    />
                </View>
            </View>
            <View style={{ flex: 1 }}>
                {children}
                {!isAuthenticated && (
                    <View
                        pointerEvents="box-none"
                        style={{ bottom: 16, position: 'absolute', right: 16, zIndex: 1100 }}
                    >
                        <DesktopUpdateButton placement="floating" />
                    </View>
                )}
            </View>
        </View>
    );
}
