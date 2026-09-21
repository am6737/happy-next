import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

/** Height of a title area the app draws for itself on Windows. */
export const WINDOWS_TITLE_BAR_HEIGHT = 40;
const WINDOWS_CONTROL_WIDTH = 46;

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

/**
 * Minimise, maximise/restore and close, for a window that draws its own title
 * area. Tracks the maximised state itself so a caller only has to place it.
 */
export function DesktopWindowControls() {
    const window = getCurrentWindow();
    const [maximized, setMaximized] = React.useState(false);

    React.useEffect(() => {
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
    }, [window]);

    return (
        <View style={{ flexDirection: 'row', height: WINDOWS_TITLE_BAR_HEIGHT }}>
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
    );
}
