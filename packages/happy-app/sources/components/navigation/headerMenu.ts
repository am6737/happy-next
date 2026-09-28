import { Platform } from 'react-native';
import type { NativeStackHeaderItemMenuAction } from '@react-navigation/native-stack';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { isRunningOnMac } from '@/utils/platform';
import { t } from '@/text';

/** Whether the page's header is the native iOS bar, which can own a menu (not Catalyst). */
export const nativeHeaderMenuAvailable = Platform.OS === 'ios' && !isRunningOnMac();

/**
 * Screen options that put a page's "more" menu on its header button as a native iOS menu: it
 * opens from the button in the system's own glass, the way iOS 26 presents these menus, instead
 * of the action sheet the page shows elsewhere. Spread after `headerRight`, which it replaces on
 * iOS; the other platforms get nothing and keep that button and its `ActionMenuModal`.
 *
 * The native menu has no secondary or custom-coloured rows; those items show as plain ones.
 */
export function headerMenuOptions(items: ActionMenuItem[], options: { disabled?: boolean } = {}) {
    if (!nativeHeaderMenuAvailable) {
        return {};
    }
    return {
        unstable_headerRightItems: () => [{
            type: 'menu' as const,
            label: t('common.more'),
            icon: { type: 'sfSymbol' as const, name: 'ellipsis' as const },
            disabled: options.disabled,
            menu: { items: items.map(headerMenuAction) },
        }],
    };
}

function headerMenuAction(item: ActionMenuItem): NativeStackHeaderItemMenuAction {
    return {
        type: 'action',
        label: item.label,
        onPress: item.onPress,
        destructive: item.destructive,
        disabled: item.disabled,
        state: item.selected ? 'on' : undefined,
    };
}
