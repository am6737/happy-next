import * as React from 'react';
import { View, Text, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '../layout';
import { useHeaderHeight, useIsTablet } from '@/utils/responsive';
import { Typography } from '@/constants/Typography';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/tauri';
import { useAuth } from '@/auth/AuthContext';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { invoke } from '@tauri-apps/api/core';

interface HeaderProps {
    title?: React.ReactNode;
    subtitle?: string;
    headerLeft?: (() => React.ReactNode) | null;
    headerRight?: (() => React.ReactNode) | null;
    headerStyle?: any;
    headerTitleStyle?: any;
    headerSubtitleStyle?: any;
    headerTintColor?: string;
    headerBackgroundColor?: string;
    headerShadowVisible?: boolean;
    headerTransparent?: boolean;
    safeAreaEnabled?: boolean;
    headerTitleAlign?: 'left' | 'center';
}

export const Header = React.memo((props: HeaderProps) => {
    const styles = stylesheet;
    const { isAuthenticated } = useAuth();
    const desktopPlatform = getDesktopPlatform();
    const needsMacOSWindowControlsInset = desktopPlatform === 'macos' && !isAuthenticated;
    const desktopDragProps = desktopPlatform ? {
        onMouseDown: (event: any) => {
            if (event.button !== 0) {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-desktop-no-drag], button, [role="button"], [tabindex], a, input, textarea, select')) {
                return;
            }

            event.preventDefault?.();
            void invoke('start_desktop_window_dragging');
        },
    } as any : {};

    const {
        title,
        subtitle,
        headerLeft,
        headerRight,
        headerStyle,
        headerTitleStyle,
        headerSubtitleStyle,
        headerTintColor, // Accept but ignore - using theme instead
        headerBackgroundColor, // Accept but ignore - using theme instead
        headerShadowVisible = true,
        headerTransparent = false,
        safeAreaEnabled = true,
        headerTitleAlign = 'center',
    } = props;

    const leftAligned = headerTitleAlign === 'left';

    const insets = useSafeAreaInsets();
    const paddingTop = safeAreaEnabled ? insets.top : 0;
    const headerHeight = useHeaderHeight();

    const containerStyle = [
        styles.container,
        headerTransparent && styles.containerTransparent,
        !headerTransparent && styles.containerNormal,
        {
            paddingTop,
        },
        headerShadowVisible && styles.shadow,
        headerStyle,
    ];

    const subtitleStyle = [
        styles.subtitle,
        headerSubtitleStyle,
    ];

    return (
        <View style={[containerStyle]}>
            <View {...desktopDragProps} style={styles.contentWrapper}>
                <View style={[styles.content, { height: headerHeight }]}>
                    <View style={[
                        styles.leftContainer,
                        leftAligned && styles.sideContainerHug,
                        needsMacOSWindowControlsInset && styles.macOSWindowControlsInset,
                    ]}>
                        {headerLeft && headerLeft()}
                    </View>

                    <View style={[styles.centerContainer, leftAligned && styles.centerContainerLeft]}>
                        <View
                            {...(desktopPlatform ? {
                                'data-desktop-no-drag': true,
                                onMouseDown: (event: any) => {
                                    event.stopPropagation?.();
                                },
                            } as any : {})}
                            style={[styles.selectableTitle, leftAligned && styles.selectableTitleLeft]}
                        >
                            {title}
                            {subtitle && <Text style={subtitleStyle} numberOfLines={1}>{subtitle}</Text>}
                        </View>
                    </View>

                    <View style={[styles.rightContainer, leftAligned && styles.sideContainerHug]}>
                        {headerRight && headerRight()}
                    </View>
                </View>
            </View>
        </View>
    );
});

// Extended navigation options to support subtitle
interface ExtendedNavigationOptions extends Partial<NativeStackHeaderProps['options']> {
    headerSubtitle?: string;
    headerSubtitleStyle?: any;
}

export const HeaderBackButton = React.memo((props: { tintColor?: string; onPress: () => void }) => {
    return (
        <Pressable
            onPress={props.onPress}
            hitSlop={15}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={{
                width: 38,
                height: 38,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Ionicons
                name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                size={Platform.OS === 'ios' ? 28 : 24}
                color={props.tintColor ?? '#000'}
            />
        </Pressable>
    );
});

// Component wrapper for navigation header
const NavigationHeaderComponent: React.FC<NativeStackHeaderProps> = React.memo((props) => {
    const { options, route, back, navigation } = props;
    const extendedOptions = options as ExtendedNavigationOptions;
    const isTablet = useIsTablet();

    // Check if we should hide back button on tablet
    const shouldHideBackButton = React.useMemo(() => {
        if (!isTablet || isTauriDesktop()) return false;

        // Get navigation state to check stack depth
        const state = navigation.getState();
        const currentIndex = state?.index ?? 0;

        // Hide back button if we're at the first or second screen in the stack
        // In tablet mode, index 0 is the empty screen, index 1 is the first real screen
        return currentIndex <= 1;
    }, [isTablet, navigation]);

    // Extract title - handle both string and function types
    let title: React.ReactNode | null = null;
    if (options.headerTitle) {
        if (typeof options.headerTitle === 'string') {
            title = (
                <Text style={[
                    { fontSize: 17, fontWeight: '600', textAlign: Platform.OS === 'ios' ? 'center' : 'left', color: options.headerTintColor || '#000' },
                    Typography.default('semiBold'),
                    options.headerTitleStyle
                ]}>
                    {options.headerTitle}
                </Text>
            );
        } else if (typeof options.headerTitle === 'function') {
            // Handle function type headerTitle
            title = options.headerTitle({ children: route.name, tintColor: options.headerTintColor });
        }
    } else if (typeof options.title === 'string') {
        title = (
            <Text style={[
                { fontSize: 17, fontWeight: '600', textAlign: Platform.OS === 'ios' ? 'center' : 'left', color: options.headerTintColor || '#000' },
                Typography.default('semiBold'),
                options.headerTitleStyle
            ]}>
                {options.title}
            </Text>
        );
    }

    // Determine header left content
    let headerLeftContent: (() => React.ReactNode) | undefined | null = null;
    if (options.headerLeft) {
        // Use custom headerLeft if provided
        headerLeftContent = () => options.headerLeft!({ canGoBack: !!back, tintColor: options.headerTintColor });
    } else if (back && options.headerBackVisible !== false && !shouldHideBackButton) {
        // Show default back button if can go back and not explicitly hidden
        // Also hide on tablet when at first or second screen
        headerLeftContent = () => (
            <HeaderBackButton
                tintColor={options.headerTintColor}
                onPress={() => navigation.goBack()}
            />
        );
    }

    return (
        <Header
            title={title}
            subtitle={extendedOptions.headerSubtitle}
            headerLeft={headerLeftContent}
            headerRight={options.headerRight ?
                () => options.headerRight!({ canGoBack: !!back, tintColor: options.headerTintColor }) :
                undefined
            }
            headerStyle={options.headerStyle}
            headerTitleStyle={options.headerTitleStyle}
            headerSubtitleStyle={extendedOptions.headerSubtitleStyle}
            headerShadowVisible={options.headerShadowVisible}
            headerTransparent={options.headerTransparent}
            headerTitleAlign={options.headerTitleAlign}
        />
    );
});

// Export a render function for React Navigation
export const createHeader = (props: NativeStackHeaderProps) => {
    if (props.options.headerShown === false) {
        return null;
    }
    return <NavigationHeaderComponent {...props} />;
};

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        position: 'relative',
        zIndex: 100,
    },
    containerTransparent: {
        backgroundColor: 'transparent',
    },
    containerNormal: {
        backgroundColor: theme.colors.header.background,
    },
    contentWrapper: {
        width: '100%',
        alignItems: 'center',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Platform.select({ ios: 8, default: 16 }),
        width: '100%',
        maxWidth: layout.headerMaxWidth,
    },
    leftContainer: {
        flexGrow: 1,
        flexBasis: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    macOSWindowControlsInset: {
        transform: [{ translateX: 72 }],
    },
    sideContainerHug: {
        flexGrow: 0,
        flexBasis: 'auto',
    },
    centerContainerLeft: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        alignItems: 'flex-start',
    },
    centerContainer: {
        flexGrow: 0,
        flexShrink: 1,
        alignSelf: 'stretch',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        overflow: 'hidden',
    },
    selectableTitle: {
        alignItems: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        maxWidth: '100%',
        userSelect: Platform.select({ web: 'text', default: undefined }),
    },
    selectableTitleLeft: {
        alignItems: 'flex-start',
    },
    rightContainer: {
        flexGrow: 1,
        flexBasis: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        textAlign: 'center',
        color: theme.colors.header.tint,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 13,
        fontWeight: '400',
        textAlign: Platform.OS === 'ios' ? 'center' : 'left',
        marginTop: 2,
        color: theme.colors.header.tint,
        ...Typography.default('regular'),
    },
    shadow: {
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 3,
        elevation: 4,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
    },
    backButton: {
        color: theme.colors.header.tint,
    },
}));
