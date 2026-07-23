import { useSocketStatus, useFriendRequests } from '@/sync/storage';
import * as React from 'react';
import { Text, View, Pressable, useWindowDimensions, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { FABWide } from './FABWide';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus } from '@/sync/storage';
import { MainView } from './MainView';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useDootaskProfile } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { requestCommandPalette } from './CommandPalette/events';
import { getDesktopPlatform, startDesktopWindowDragging } from '@/desktop/desktopWindowUtils';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.groupped.background,
        position: 'relative',
    },
    desktopTitleBar: {
        alignItems: 'center',
        backgroundColor: theme.colors.groupped.background,
        flexDirection: 'row',
        height: 48,
        paddingRight: 12,
    },
    desktopTrafficLightSpacer: {
        height: 48,
        width: 88,
    },
    desktopTitleBarControls: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 5,
        transform: [{ translateY: -2 }],
    },
    desktopTitleBarSpacer: {
        flex: 1,
        height: 48,
    },
    desktopNavigationButton: {
        alignItems: 'center',
        borderRadius: 6,
        height: 28,
        justifyContent: 'center',
        width: 28,
    },
    logoContainer: {
        width: 32,
    },
    logo: {
        height: 24,
        width: 24,
    },
    titleContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
    },
    titleContainerLeft: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'flex-start',
        marginLeft: 4,
        justifyContent: 'center',
    },
    titleText: {
        fontSize: 17,
        fontWeight: '500',
        color: theme.colors.header.tint,
        whiteSpace: Platform.select({ web: 'nowrap', default: undefined }),
        ...Typography.default('semiBold'),
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
    },
    statusDot: {
        marginRight: 4,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    rightContainer: {
        marginLeft: 'auto',
        alignItems: 'flex-end',
        flexDirection: 'row',
        gap: 8,
    },
    settingsButton: {
        color: theme.colors.header.tint,
    },
    notificationButton: {
        position: 'relative',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: theme.colors.status.error,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        ...Typography.default('semiBold'),
    },
    // Status colors
    statusConnected: {
        color: theme.colors.status.connected,
    },
    statusConnecting: {
        color: theme.colors.status.connecting,
    },
    statusDisconnected: {
        color: theme.colors.status.disconnected,
    },
    statusError: {
        color: theme.colors.status.error,
    },
    statusDefault: {
        color: theme.colors.status.default,
    },
    indicatorDot: {
        position: 'absolute',
        top: 0,
        right: -2,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.text,
    },
}));

type SidebarViewProps = {
    sidebarWidth?: number;
};

export const SidebarView = React.memo((props: SidebarViewProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const headerHeight = useHeaderHeight();
    const socketStatus = useSocketStatus();
    const realtimeStatus = useRealtimeStatus();
    const friendRequests = useFriendRequests();
    const inboxHasContent = useInboxHasContent();
    const dootaskProfile = useDootaskProfile();
    const [isSearchHovered, setIsSearchHovered] = React.useState(false);
    const isDesktopMacOS = getDesktopPlatform() === 'macos';
    const desktopDragProps = isDesktopMacOS ? {
        'data-tauri-drag-region': true,
        onMouseDown: (event: any) => {
            if (event.button === 0) {
                event.preventDefault?.();
                startDesktopWindowDragging();
            }
        },
    } as any : {};
    // Compute connection status once per render (theme-reactive, no stale memoization)
    const connectionStatus = (() => {
        const { status } = socketStatus;
        switch (status) {
            case 'connected':
                return {
                    color: styles.statusConnected.color,
                    isPulsing: false,
                    text: t('status.connected'),
                    textColor: styles.statusConnected.color
                };
            case 'connecting':
                return {
                    color: styles.statusConnecting.color,
                    isPulsing: true,
                    text: t('status.connecting'),
                    textColor: styles.statusConnecting.color
                };
            case 'disconnected':
                return {
                    color: styles.statusDisconnected.color,
                    isPulsing: false,
                    text: t('status.disconnected'),
                    textColor: styles.statusDisconnected.color
                };
            case 'error':
                return {
                    color: styles.statusError.color,
                    isPulsing: false,
                    text: t('status.error'),
                    textColor: styles.statusError.color
                };
            default:
                return {
                    color: styles.statusDefault.color,
                    isPulsing: false,
                    text: '',
                    textColor: styles.statusDefault.color
                };
        }
    })();

    // Calculate sidebar width and determine title positioning
    // Uses same formula as SidebarNavigator.tsx:18 for consistency
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const sidebarWidth = props.sidebarWidth ?? Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
    // 3 icons (108px total), threshold 328px → left-justify below ~340px
    const shouldLeftJustify = sidebarWidth < 340 || !!dootaskProfile;

    // iPad Stage Manager / Mac Catalyst draws window controls (traffic lights)
    // at the top-left, OUTSIDE of safeAreaInsets — system chrome that overlays
    // the app's content. Detect the most common cases via heuristic and reserve
    // ~60px so the logo/title clear them. (A real fix would need a native module
    // calling iOS 26's window control APIs.)
    const screenWidth = Dimensions.get('screen').width;
    const screenHeight = Dimensions.get('screen').height;
    const isWindowedIos = Platform.OS === 'ios' && (windowWidth < screenWidth - 1 || windowHeight < screenHeight - 1);
    const hasWindowControls = isWindowedIos || isRunningOnMac();
    const windowControlsInset = hasWindowControls ? 60 : 0;

    const handleNewSession = React.useCallback(() => {
        router.push('/new');
    }, [router]);

    const handleGoHome = React.useCallback(() => {
        try {
            router.dismissAll();
        } catch (_) {
            // Already at root of the current stack.
        }
    }, [router]);

    // Title content used in both centered and left-justified modes (DRY)
    const titleContent = (
        <>
            <Text
                style={styles.titleText}
                numberOfLines={1}
                ref={(el: any) => {
                    if (Platform.OS === 'web' && el) {
                        el.title = t('sidebar.sessionsTitle');
                    }
                }}
            >
                {t('sidebar.sessionsTitle')}
            </Text>
            {connectionStatus.text && (
                <View style={styles.statusContainer}>
                    <StatusDot
                        color={connectionStatus.color}
                        isPulsing={connectionStatus.isPulsing}
                        size={6}
                        style={styles.statusDot}
                    />
                    <Text style={[styles.statusText, { color: connectionStatus.textColor }]}>
                        {connectionStatus.text}
                    </Text>
                </View>
            )}
        </>
    );

    const navigationButtons = (
        <>
            <Pressable
                accessibilityLabel={t('tabs.inbox')}
                onPress={() => router.navigate('/(app)/inbox')}
                hitSlop={10}
                style={[
                    styles.notificationButton,
                    isDesktopMacOS && styles.desktopNavigationButton,
                ]}
            >
                <Image
                    source={require('@/assets/images/navigation/inbox.png')}
                    contentFit="contain"
                    style={{ width: 20, height: 20, margin: 4, opacity: isDesktopMacOS ? 0.62 : 1 }}
                    tintColor={theme.colors.header.tint}
                />
                {friendRequests.length > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                            {friendRequests.length > 99 ? '99+' : friendRequests.length}
                        </Text>
                    </View>
                )}
                {inboxHasContent && friendRequests.length === 0 && (
                    <View style={styles.indicatorDot} />
                )}
            </Pressable>
            {!!dootaskProfile && (
                <Pressable
                    accessibilityLabel={t('tabs.dootask')}
                    onPress={() => router.navigate('/(app)/dootask')}
                    hitSlop={10}
                    style={isDesktopMacOS ? styles.desktopNavigationButton : undefined}
                >
                    <Image
                        source={require('@/assets/images/navigation/todo.png')}
                        contentFit="contain"
                        style={{ width: 20, height: 20, margin: 4, opacity: isDesktopMacOS ? 0.62 : 1 }}
                        tintColor={theme.colors.header.tint}
                    />
                </Pressable>
            )}
            <Pressable
                accessibilityLabel={t('tabs.settings')}
                onPress={() => router.navigate('/settings')}
                hitSlop={10}
                style={isDesktopMacOS ? styles.desktopNavigationButton : undefined}
            >
                <Image
                    source={require('@/assets/images/navigation/setting.png')}
                    contentFit="contain"
                    style={{ width: 20, height: 20, margin: 4, opacity: isDesktopMacOS ? 0.62 : 1 }}
                    tintColor={theme.colors.header.tint}
                />
            </Pressable>
        </>
    );

    return (
        <>
            <View style={[styles.container, { paddingTop: safeArea.top }]}>
                {isDesktopMacOS && (
                    <View style={styles.desktopTitleBar}>
                        <View
                            {...desktopDragProps}
                            style={styles.desktopTrafficLightSpacer}
                        />
                        <View style={styles.desktopTitleBarControls}>
                            {navigationButtons}
                        </View>
                        <View
                            {...desktopDragProps}
                            style={styles.desktopTitleBarSpacer}
                        />
                    </View>
                )}
                <View
                    {...(isDesktopMacOS ? { 'data-tauri-drag-region': true } as any : {})}
                    style={[
                        styles.header,
                        {
                            height: headerHeight,
                            paddingLeft: isDesktopMacOS
                                ? Math.max(safeArea.left, 0) + 16
                                : Math.max(safeArea.left, windowControlsInset) + 16,
                        },
                    ]}
                >
                    {/* Logo - always first */}
                    <Pressable style={styles.logoContainer} onPress={handleGoHome}>
                        <Image
                            source={theme.dark ? require('@/assets/images/logo-white.png') : require('@/assets/images/logo-black.png')}
                            contentFit="contain"
                            style={[styles.logo, { height: 24, width: 24 }]}
                        />
                    </Pressable>

                    {/* Left-justified title - in document flow, prevents overlap */}
                    {shouldLeftJustify && (
                        <View style={styles.titleContainerLeft}>
                            {titleContent}
                        </View>
                    )}

                    {/* Navigation icons */}
                    <View style={styles.rightContainer}>
                        {isDesktopMacOS ? (
                            <Pressable
                                accessibilityLabel={t('commandPalette.placeholder')}
                                onPress={requestCommandPalette}
                                onHoverIn={() => setIsSearchHovered(true)}
                                onHoverOut={() => setIsSearchHovered(false)}
                                hitSlop={10}
                                style={styles.desktopNavigationButton}
                            >
                                <Ionicons
                                    name="search-outline"
                                    size={20}
                                    color={theme.colors.header.tint}
                                    style={{ opacity: isSearchHovered ? 1 : 0.6 }}
                                />
                            </Pressable>
                        ) : navigationButtons}
                    </View>

                    {/* Centered title - absolute positioned over full header */}
                    {!shouldLeftJustify && (
                        <View style={styles.titleContainer}>
                            {titleContent}
                        </View>
                    )}
                </View>
                {realtimeStatus !== 'disconnected' && (
                    <VoiceAssistantStatusBar variant="sidebar" />
                )}
                <MainView variant="sidebar" />
            </View>
            <FABWide onPress={handleNewSession} />
        </>
    )
});
