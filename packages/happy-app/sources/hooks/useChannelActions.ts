import * as React from 'react';
import { useRouter } from 'expo-router';
import type { Teammate } from 'happy-wire';
import { Modal } from '@/modal';
import { ChannelApiError } from '@/sync/apiChannels';
import { sync } from '@/sync/sync';
import { t } from '@/text';

function channelErrorMessage(failure: unknown): string {
    if (failure instanceof ChannelApiError) {
        if (failure.code === 'full') return t('channels.settings.full');
        if (failure.code === 'last_member') return t('channels.settings.lastMember');
        if (failure.code === 'archived') return t('channels.settings.archived');
    }
    return t('channels.error');
}

/**
 * Group settings actions: rename, add or remove Agents, start a new context and delete the group. One action runs
 * at a time (`busy`); destructive ones ask first. Each resolves to whether it succeeded so sheets can close only
 * then, and failures are kept in `error` for the page to show inline.
 */
export function useChannelActions(id: string) {
    const router = useRouter();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const run = async (work: () => Promise<void>): Promise<boolean> => {
        if (busy) return false;
        setBusy(true);
        setError(null);
        try {
            await work();
            return true;
        } catch (failure) {
            setError(channelErrorMessage(failure));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const rename = (title: string) => run(() => sync.channels.rename(id, title).then(() => undefined));


    const addMembers = (teammates: Teammate[]) => run(() => sync.channels.addMembers(id, teammates).then(() => undefined));

    const removeMember = async (teammate: Teammate) => {
        if (busy) return false;
        const confirmed = await Modal.confirm(t('channels.settings.remove'), t('channels.settings.confirmRemove', { name: teammate.name }),
            { confirmText: t('channels.settings.remove'), destructive: true });
        if (!confirmed) return false;
        return run(() => sync.channels.removeMember(id, teammate.id).then(() => undefined));
    };

    const reset = async () => {
        if (busy) return false;
        if (!await Modal.confirm(t('channels.settings.startNewContext'), t('channels.settings.confirmReset'), { confirmText: t('channels.settings.startNewContext') })) return false;
        return run(() => sync.channels.reset(id));
    };

    const remove = async () => {
        if (busy) return false;
        if (!await Modal.confirm(t('channels.settings.deleteGroup'), t('channels.settings.confirmDelete'), { confirmText: t('channels.settings.deleteGroup'), destructive: true })) return false;
        // Leave the deleted chat and its settings page behind in one step.
        return run(async () => {
            await sync.channels.delete(id);
            router.dismissAll();
        });
    };

    return { busy, error, rename, addMembers, removeMember, reset, remove };
}
