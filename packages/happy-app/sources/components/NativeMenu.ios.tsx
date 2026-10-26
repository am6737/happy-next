import * as React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, ContextMenu, Divider, Host, Picker, Rectangle } from '@expo/ui/swift-ui';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { foregroundStyle, opacity } from '@expo/ui/swift-ui/modifiers';
import { useUnistyles } from 'react-native-unistyles';
import { isRunningOnMac } from '@/utils/platform';
import type { ActionMenuItem } from './ActionMenu';
import { NativeMenu as FallbackMenu, type NativeMenuProps } from './NativeMenu';

type MenuButtonElement = {
    type: 'action' | 'group';
    id?: string;
    title?: string;
    systemImage?: string;
    destructive?: boolean;
    disabled?: boolean;
    checked?: boolean;
    inline?: boolean;
    children?: MenuButtonElement[];
};

type MenuButtonProps = {
    menu: { items: MenuButtonElement[] };
    // Not `onPress`: React Native has a bubbling `topPress` already, and a direct one of the same name throws
    onPrimaryAction: () => void;
    onSelectAction: (event: { nativeEvent: { id: string } }) => void;
    style?: StyleProp<ViewStyle>;
};

// `modules/context-menu`; a binary built before it has the menu button falls back to the sheet.
const MenuButton: React.ComponentType<MenuButtonProps> | null =
    !isRunningOnMac() && requireOptionalNativeModule('HappyMenuButton')
        ? requireNativeViewManager('HappyMenuButton')
        : null;

/** The rows as the native menu's sections, a new one at each `startsSection`. */
function menuButtonItems(items: ActionMenuItem[]): MenuButtonElement[] {
    const sections: MenuButtonElement[] = [];
    items.forEach((item, index) => {
        if (index === 0 || item.startsSection) {
            sections.push({ type: 'group', inline: true, children: [] });
        }
        sections[sections.length - 1].children!.push({
            type: 'action',
            id: String(index),
            title: item.label,
            systemImage: item.icon?.sfSymbol,
            destructive: item.destructive,
            disabled: item.disabled,
            checked: item.selected,
        });
    });
    return sections;
}

/**
 * The long-press trigger: a UIKit button over the content, whose tap is `onPress` and whose long
 * press opens the menu out of it with the haptic the sessions list's "+" plays (see
 * `HappyMenuButtonModule`).
 */
function LongPressMenu({ items, onPress, style, children }: {
    items: ActionMenuItem[];
    onPress?: () => void;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}) {
    // Handlers are looked up when the event arrives, so they are always the latest render's
    const latestRef = React.useRef({ items, onPress });
    latestRef.current = { items, onPress };
    const menu = React.useMemo(() => ({ items: menuButtonItems(items) }), [items]);
    const handlePress = React.useCallback(() => latestRef.current.onPress?.(), []);
    const handleSelect = React.useCallback((event: { nativeEvent: { id: string } }) => {
        latestRef.current.items[Number(event.nativeEvent.id)]?.onPress();
    }, []);
    const NativeButton = MenuButton!;
    return (
        <View style={style}>
            {children}
            <NativeButton style={StyleSheet.absoluteFill} menu={menu} onPrimaryAction={handlePress} onSelectAction={handleSelect} />
        </View>
    );
}

/**
 * A trigger that opens its menu as a native iOS menu, out of the trigger in the system's own glass:
 * on a tap a SwiftUI `Menu`; on a long press a UIKit button's menu (`LongPressMenu`), a tap then
 * calling `onPress`, as on a native bar button. The rows are the page's `ActionMenuItem`s, so its
 * `ActionMenuModal` keeps serving Catalyst and the other platforms.
 *
 * A menu whose rows all carry `selected` is a choice of one value, shown as an inline picker with
 * the system's checkmark; any other is a list of actions, destructive ones in red. Rows cannot be
 * coloured or muted in a native menu, so `color` and `secondary` are dropped.
 *
 * The trigger's content stays a React Native view; the menu's own trigger is a SwiftUI shape laid
 * over it, all but transparent (fully clear shapes are not hit-tested) and tinted toward the
 * theme's background so it does not show as a grey patch on it. Hosting the content inside
 * SwiftUI instead loses it: once its row scrolls out of view and back, SwiftUI rebuilds the trigger
 * and the React Native view it had adopted is gone.
 */
export const NativeMenu = React.memo((props: NativeMenuProps) => {
    const { activation = 'press', onPress, opensUpward, disabled, style, children } = props;
    // iOS orders the rows outward from the trigger; reversed, a menu above it still reads top-down
    const items = opensUpward ? [...props.items].reverse() : props.items;
    const { theme } = useUnistyles();

    if (isRunningOnMac()) {
        return <FallbackMenu {...props} />;
    }
    if (disabled) {
        return <View style={style}>{children}</View>;
    }
    if (activation === 'longPress') {
        if (!MenuButton) {
            return <FallbackMenu {...props} />;
        }
        return <LongPressMenu items={items} onPress={onPress} style={style}>{children}</LongPressMenu>;
    }

    const isChoice = items.length > 0 && items.every((item) => typeof item.selected === 'boolean');
    return (
        <View style={style}>
            {children}
            <Host style={StyleSheet.absoluteFill}>
                <ContextMenu activationMethod="singlePress">
                    <ContextMenu.Items>
                        {isChoice ? (
                            <Picker
                                variant="inline"
                                options={items.map((item) => item.label)}
                                selectedIndex={items.findIndex((item) => item.selected)}
                                onOptionSelected={({ nativeEvent }) => items[nativeEvent.index]?.onPress()}
                            />
                        ) : (
                            items.map((item, index) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <React.Fragment key={index}>
                                    {item.startsSection && index > 0 && <Divider />}
                                    <Button
                                        role={item.destructive ? 'destructive' : 'default'}
                                        disabled={item.disabled}
                                        systemImage={item.icon?.sfSymbol}
                                        onPress={item.onPress}
                                    >
                                        {item.label}
                                    </Button>
                                </React.Fragment>
                            ))
                        )}
                    </ContextMenu.Items>
                    <ContextMenu.Trigger>
                        <Rectangle
                            modifiers={[
                                foregroundStyle(theme.dark ? 'black' : 'white'),
                                opacity(0.011),
                            ]}
                        />
                    </ContextMenu.Trigger>
                </ContextMenu>
            </Host>
        </View>
    );
});
NativeMenu.displayName = 'NativeMenu';
