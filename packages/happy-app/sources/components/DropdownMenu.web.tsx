import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import type { DropdownMenuProps } from './DropdownMenu';

const MENU_WIDTH = 180;
const MENU_GAP = 4;
const WINDOW_MARGIN = 8;

type Anchor = { top: number; left: number };

/**
 * The web's dropdown: a popover under the button, left-aligned with it and kept inside the window.
 * A click outside or Escape closes it; picking a row closes it, then runs the row.
 */
export const DropdownMenu = React.memo(({ items, accessibilityLabel, style, hoveredStyle, children }: DropdownMenuProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const triggerRef = React.useRef<View | null>(null);
    const [anchor, setAnchor] = React.useState<Anchor | null>(null);

    const open = React.useCallback(() => {
        const element = triggerRef.current as unknown as HTMLElement | null;
        const rect = element?.getBoundingClientRect?.();
        if (!rect) return;
        setAnchor({
            top: rect.bottom + MENU_GAP,
            left: Math.max(WINDOW_MARGIN, Math.min(rect.left, window.innerWidth - MENU_WIDTH - WINDOW_MARGIN)),
        });
    }, []);
    const close = React.useCallback(() => setAnchor(null), []);

    return (
        <>
            <Pressable
                ref={triggerRef}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ expanded: anchor !== null }}
                onPress={open}
                style={({ hovered, pressed }: any) => [style, (hovered || pressed || anchor !== null) && hoveredStyle]}
            >
                {children}
            </Pressable>
            <Modal visible={anchor !== null} transparent animationType="none" onRequestClose={close}>
                <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={accessibilityLabel} />
                {anchor && (
                    <View accessibilityRole="menu" style={[styles.menu, { top: anchor.top, left: anchor.left }]}>
                        {items.map((item) => (
                            <Pressable
                                key={item.label}
                                accessibilityRole="menuitem"
                                disabled={item.disabled}
                                onPress={() => {
                                    close();
                                    item.onPress();
                                }}
                                style={({ hovered, pressed }: any) => [
                                    styles.item,
                                    (hovered || pressed) && !item.disabled && styles.itemHovered,
                                ]}
                            >
                                <Text
                                    numberOfLines={1}
                                    style={[
                                        styles.itemText,
                                        item.destructive && { color: theme.colors.textDestructive },
                                        item.disabled && styles.itemTextDisabled,
                                    ]}
                                >
                                    {item.label}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </Modal>
        </>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    menu: {
        position: 'absolute',
        width: MENU_WIDTH,
        padding: 4,
        borderRadius: 10,
        backgroundColor: theme.dark ? theme.colors.surfaceHighest : theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.18)',
    },
    item: {
        height: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRadius: 6,
    },
    itemHovered: {
        backgroundColor: theme.colors.surfacePressed,
    },
    itemText: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    itemTextDisabled: {
        color: theme.colors.textSecondary,
        opacity: 0.6,
    },
}));
