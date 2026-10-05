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
 * iOS; the other platforms get nothing and keep that button and its `ActionMenuModal`. The button is
 * "…" (read out as "More") unless `icon` and `label` say otherwise, as for a menu of things to create.
 *
 * `null` items take the menu away again, for a screen whose header only has it some of the time.
 * The native menu has no secondary or custom-coloured rows; those items show as plain ones.
 */
export function headerMenuOptions(items: ActionMenuItem[] | null, options: { disabled?: boolean; icon?: 'ellipsis' | 'plus'; label?: string } = {}) {
    if (!nativeHeaderMenuAvailable) {
        return {};
    }
    if (!items) {
        // Header options are merged, so a screen that only sometimes has the menu has to clear it.
        return { unstable_headerRightItems: undefined };
    }
    return {
        unstable_headerRightItems: () => [{
            type: 'menu' as const,
            label: options.label ?? t('common.more'),
            icon: { type: 'sfSymbol' as const, name: options.icon ?? 'ellipsis' },
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
