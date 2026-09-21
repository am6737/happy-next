import React from 'react';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { SessionContextMenuPortal } from '@/components/SessionContextMenuPortal';

/**
 * A menu on something that was right-clicked, or long-pressed where there is no
 * right button.
 *
 * The two platforms open different things on purpose. A pointer has a position
 * to hang a menu off, so on the web the menu appears at the cursor; without one
 * the only honest place for it is the bottom of the screen, which is what the
 * modal does.
 *
 * The anchor and dismissal mechanics are the ones `SessionContextMenu` settled
 * on, and are deliberately the same rather than shared with it: that component's
 * copy is tangled up with session-only concerns (quick action kinds, the
 * highlight ring, the colour palette, its scroll anchor), and three of the
 * busiest lists in the app depend on it. Copying the mechanism is cheaper than
 * refactoring it, and this stays free to differ.
 */
export interface TerminalTabContextMenuProps {
    items: ActionMenuItem[];
    /** Native only — the floating menu has no room for one. */
    title: string;
    children: React.ReactNode;
}

type MenuPosition = { x: number; y: number };

const MENU_WIDTH = 212;
const ITEM_HEIGHT = 42;
const MENU_PADDING = 8;
const EDGE_GAP = 8;
const LONG_PRESS_MS = 450;
/** A press this soon after a long press is the back half of that gesture. */
const PRESS_AFTER_LONG_PRESS_MS = 1_000;

export function TerminalTabContextMenu({ items, title, children }: TerminalTabContextMenuProps) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const [position, setPosition] = React.useState<MenuPosition | null>(null);
    const [nativeVisible, setNativeVisible] = React.useState(false);
    const [hovered, setHovered] = React.useState<string | null>(null);
    const lastLongPressAt = React.useRef(0);
    const menuRef = React.useRef<HTMLElement | null>(null);

    const close = React.useCallback(() => {
        setPosition(null);
        setHovered(null);
    }, []);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || position === null || typeof document === 'undefined') {
            return;
        }

        const isInsideMenu = (target: EventTarget | null) => (
            target instanceof Node && menuRef.current?.contains(target)
        );
        const handlePointerDown = (event: PointerEvent) => {
            if (!isInsideMenu(event.target)) {
                close();
            }
        };
        const handleContextMenuOutside = (event: MouseEvent) => {
            if (isInsideMenu(event.target)) {
                event.preventDefault();
                return;
            }
            // Left alone rather than prevented: right-clicking elsewhere in the
            // app should still get whatever menu belongs to that thing.
            close();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
            }
        };
        // Any scroll closes it, rather than only a scroll that moves the strip:
        // knowing which scrolls matter means anchoring to a tab the way the
        // session menu anchors to a row, and a menu left floating over moved
        // content is worse than one that closed a moment early.
        const handleScroll = () => close();

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('contextmenu', handleContextMenuOutside, true);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('contextmenu', handleContextMenuOutside, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [close, position]);

    if (Platform.OS !== 'web') {
        const child = React.isValidElement(children)
            ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
                onLongPress: (event: unknown) => {
                    (children.props as { onLongPress?: (event: unknown) => void }).onLongPress?.(event);
                    lastLongPressAt.current = Date.now();
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setNativeVisible(true);
                },
                onPress: (event: unknown) => {
                    if (Date.now() - lastLongPressAt.current < PRESS_AFTER_LONG_PRESS_MS) {
                        return;
                    }
                    (children.props as { onPress?: (event: unknown) => void }).onPress?.(event);
                },
                delayLongPress: LONG_PRESS_MS,
            })
            : children;

        return (
            <>
                {child}
                <ActionMenuModal
                    items={items}
                    // Every item waits for the menu to finish closing. Renaming
                    // opens a prompt of its own, and a dialog raised while this
                    // one is still animating out is a dialog iOS drops.
                    deferItemPress
                    onClose={() => setNativeVisible(false)}
                    title={title}
                    visible={nativeVisible}
                />
            </>
        );
    }

    // The menu has no trailing cancel row, unlike the modal's list.
    const menuHeight = items.length * ITEM_HEIGHT + MENU_PADDING;
    const left = position ? Math.max(EDGE_GAP, Math.min(position.x, width - MENU_WIDTH - EDGE_GAP)) : 0;
    const top = position ? Math.max(EDGE_GAP, Math.min(position.y, height - menuHeight - EDGE_GAP)) : 0;

    const handleContextMenu = (event: {
        preventDefault: () => void;
        stopPropagation: () => void;
        nativeEvent: { pageX: number; pageY: number; clientX?: number; clientY?: number };
    }) => {
        event.preventDefault();
        event.stopPropagation();
        setHovered(null);
        setPosition({
            x: event.nativeEvent.clientX ?? event.nativeEvent.pageX,
            y: event.nativeEvent.clientY ?? event.nativeEvent.pageY,
        });
    };

    return (
        <>
            {/* Cloned rather than wrapped, on both platforms: a wrapper would be
                the tab strip's child instead of the tab, and the strip measures
                its children to know where each tab sits — every one of them
                would measure at zero. */}
            {React.isValidElement(children)
                ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
                    // Spread rather than written inline: `onContextMenu` is a DOM
                    // prop that the React Native types do not carry.
                    ...{ onContextMenu: handleContextMenu },
                })
                : children}
            {position !== null && (
                <SessionContextMenuPortal>
                    <View
                        ref={(node) => {
                            menuRef.current = node as unknown as HTMLElement | null;
                        }}
                        pointerEvents="auto"
                        style={[styles.menu, { left, top }]}
                    >
                        {items.map((item) => (
                            <Pressable
                                disabled={item.disabled}
                                key={item.label}
                                onHoverIn={() => setHovered(item.label)}
                                onHoverOut={() => setHovered((current) => (current === item.label ? null : current))}
                                onPress={(event) => {
                                    event.stopPropagation?.();
                                    close();
                                    item.onPress();
                                }}
                                style={({ pressed }) => [
                                    styles.item,
                                    (pressed || hovered === item.label) && { backgroundColor: theme.colors.surfacePressed },
                                    item.disabled && styles.disabled,
                                ]}
                            >
                                <Text
                                    numberOfLines={1}
                                    style={[styles.itemText, item.destructive && styles.destructiveText]}
                                >
                                    {item.label}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </SessionContextMenuPortal>
            )}
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    menu: {
        position: 'absolute',
        width: MENU_WIDTH,
        paddingTop: MENU_PADDING,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
        elevation: 12,
        overflow: 'hidden',
    },
    item: {
        height: ITEM_HEIGHT,
        paddingHorizontal: 12,
        justifyContent: 'center',
    },
    itemText: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    destructiveText: {
        color: theme.colors.textDestructive,
    },
    disabled: {
        opacity: 0.4,
    },
}));
