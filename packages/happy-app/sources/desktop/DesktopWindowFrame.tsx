import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/AuthContext';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useDootaskProfile, useFriendRequests, useSocketStatus } from '@/sync/storage';
import { t } from '@/text';
import { StatusDot } from '@/components/StatusDot';
import { requestCommandPalette } from '@/components/CommandPalette/events';
import { DesktopUpdateButton } from './DesktopUpdateButton';
import { getDesktopPlatform, handleDesktopTitleBarMouseDown } from './desktopWindowUtils';
import { useDesktopWindowFullscreen } from './useDesktopWindowFullscreen';

const WINDOWS_TITLE_BAR_HEIGHT = 40;
const WINDOWS_CONTROL_WIDTH = 46;
const MACOS_RIGHT_DRAG_STRIP_LEFT = 360;
const WINDOWS_NAVIGATION_BUTTON_SIZE = 30;

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

type WindowsNavigationButtonProps = {
    accessibilityLabel: string;
    children: React.ReactNode;
    onPress: () => void;
};

function WindowsNavigationButton({ accessibilityLabel, children, onPress }: WindowsNavigationButtonProps) {
    const { theme } = useUnistyles();

    return (
        <Pressable
            {...({ 'data-desktop-no-drag': true } as any)}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onPress={onPress}
            ref={(element: any) => {
                if (element && typeof element === 'object') {
                    element.title = accessibilityLabel;
                }
            }}
            style={({ hovered, pressed }: any) => ({
                alignItems: 'center',
                backgroundColor: hovered || pressed ? theme.colors.surfacePressed : 'transparent',
                borderRadius: 5,
                height: WINDOWS_NAVIGATION_BUTTON_SIZE,
                justifyContent: 'center',
                position: 'relative',
                width: WINDOWS_NAVIGATION_BUTTON_SIZE,
            })}
        >
            {children}
        </Pressable>
    );
}

function WindowsTitleBarNavigation() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const socketStatus = useSocketStatus();
    const friendRequests = useFriendRequests();
    const inboxHasContent = useInboxHasContent();
    const dootaskProfile = useDootaskProfile();
    const { width: windowWidth } = useWindowDimensions();
    const showConnectionText = windowWidth >= 720;

    const connectionStatus = (() => {
        switch (socketStatus.status) {
            case 'connected':
                return { color: theme.colors.status.connected, isPulsing: false, text: t('status.connected') };
            case 'connecting':
                return { color: theme.colors.status.connecting, isPulsing: true, text: t('status.connecting') };
            case 'disconnected':
                return { color: theme.colors.status.disconnected, isPulsing: false, text: t('status.disconnected') };
            case 'error':
                return { color: theme.colors.status.error, isPulsing: false, text: t('status.error') };
            default:
                return { color: theme.colors.status.default, isPulsing: false, text: '' };
        }
    })();

    return (
        <View
            {...({ 'data-desktop-no-drag': true } as any)}
            style={{ alignItems: 'center', flexDirection: 'row', gap: 2, height: WINDOWS_TITLE_BAR_HEIGHT }}
        >
            {!!connectionStatus.text && (
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 8 }}>
                    <StatusDot
                        color={connectionStatus.color}
                        isPulsing={connectionStatus.isPulsing}
                        size={6}
                    />
                    {showConnectionText && (
                        <Text style={{ color: connectionStatus.color, fontSize: 11, fontWeight: '500' }}>
                            {connectionStatus.text}
                        </Text>
                    )}
                </View>
            )}
            <WindowsNavigationButton
                accessibilityLabel={t('tabs.inbox')}
                onPress={() => router.navigate('/(app)/inbox')}
            >
                <Image
                    source={require('@/assets/images/navigation/inbox.png')}
                    contentFit="contain"
                    style={{ height: 18, width: 18 }}
                    tintColor={theme.colors.header.tint}
                />
                {friendRequests.length > 0 ? (
                    <View style={{
                        alignItems: 'center',
                        backgroundColor: theme.colors.status.error,
                        borderRadius: 7,
                        height: 14,
                        justifyContent: 'center',
                        minWidth: 14,
                        paddingHorizontal: 3,
                        position: 'absolute',
                        right: -2,
                        top: -2,
                    }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '600' }}>
                            {friendRequests.length > 99 ? '99+' : friendRequests.length}
                        </Text>
                    </View>
                ) : inboxHasContent ? (
                    <View style={{
                        backgroundColor: '#007AFF',
                        borderRadius: 3,
                        height: 6,
                        position: 'absolute',
                        right: 2,
                        top: 2,
                        width: 6,
                    }} />
                ) : null}
            </WindowsNavigationButton>
            {!!dootaskProfile && (
                <WindowsNavigationButton
                    accessibilityLabel={t('tabs.dootask')}
                    onPress={() => router.navigate('/(app)/dootask')}
                >
                    <Image
                        source={require('@/assets/images/navigation/todo.png')}
                        contentFit="contain"
                        style={{ height: 18, width: 18 }}
                        tintColor={theme.colors.header.tint}
                    />
                </WindowsNavigationButton>
            )}
            <WindowsNavigationButton
                accessibilityLabel={t('tabs.settings')}
                onPress={() => router.navigate('/settings')}
            >
                <Image
                    source={require('@/assets/images/navigation/setting.png')}
                    contentFit="contain"
                    style={{ height: 18, width: 18 }}
                    tintColor={theme.colors.header.tint}
                />
            </WindowsNavigationButton>
            <WindowsNavigationButton
                accessibilityLabel={t('commandPalette.placeholder')}
                onPress={requestCommandPalette}
            >
                <Ionicons name="search-outline" size={18} color={theme.colors.header.tint} />
            </WindowsNavigationButton>
            <DesktopUpdateButton placement="titleBar" />
        </View>
    );
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
    const { theme } = useUnistyles();
    const desktopPlatform = getDesktopPlatform();
    const { isAuthenticated } = useAuth();
    const [maximized, setMaximized] = React.useState(false);
    const isWindowsFullscreen = useDesktopWindowFullscreen(desktopPlatform === 'windows');
    const { width: windowWidth } = useWindowDimensions();

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

    if (isWindowsFullscreen) {
        return <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>{children}</View>;
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
                    style={{ alignItems: 'center', flexDirection: 'row', gap: 8, paddingLeft: 12 }}
                >
                    <Image
                        source={theme.dark
                            ? require('@/assets/images/logo-white.png')
                            : require('@/assets/images/logo-black.png')}
                        contentFit="contain"
                        style={{ height: 20, width: 20 }}
                    />
                    {windowWidth >= 600 && (
                        <Text
                            selectable={false}
                            style={{ color: theme.colors.header.tint, fontSize: 13, fontWeight: '600' }}
                        >
                            Happy Next
                        </Text>
                    )}
                </View>
                <View
                    {...({ 'data-tauri-drag-region': true } as any)}
                    style={{ flex: 1, height: titleBarHeight }}
                />
                {isAuthenticated && <WindowsTitleBarNavigation />}
                <View style={{ backgroundColor: theme.colors.divider, height: 20, marginHorizontal: 7, width: 1 }} />
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
