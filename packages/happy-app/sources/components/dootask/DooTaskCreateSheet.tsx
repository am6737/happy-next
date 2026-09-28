import * as React from 'react';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { t } from '@/text';

type Props = {
    visible: boolean;
    onClose: () => void;
    onSelectTask: () => void;
    onSelectProject: () => void;
};

/** The DooTask "create" choices, shared by this sheet and the native header menu (iOS). */
export function useDooTaskCreateItems(onSelectTask: () => void, onSelectProject: () => void): ActionMenuItem[] {
    return React.useMemo(() => [
        { label: t('dootask.addTask'), onPress: onSelectTask },
        { label: t('dootask.addProject'), onPress: onSelectProject },
    ], [onSelectTask, onSelectProject]);
}

export const DooTaskCreateSheet = React.memo(({ visible, onClose, onSelectTask, onSelectProject }: Props) => {
    const items = useDooTaskCreateItems(onSelectTask, onSelectProject);

    return (
        <ActionMenuModal
            visible={visible}
            items={items}
            onClose={onClose}
            deferItemPress
        />
    );
});
