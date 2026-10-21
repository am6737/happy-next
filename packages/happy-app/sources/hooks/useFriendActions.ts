import * as React from 'react';
import { useAuth } from '@/auth/AuthContext';
import { sendFriendRequest, removeFriend } from '@/sync/apiFriends';
import { UserProfile, getDisplayName } from '@/sync/friendTypes';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { t } from '@/text';
import { trackFriendsConnect } from '@/track';
import { showToast } from '@/components/Toast';
import type { ActionMenuItem } from '@/components/ActionMenu';

/**
 * What can be done about a relationship, for both the inbox's rows and the user's page: accept or
 * deny a request made to me, withdraw one I made, remove a friend, or ask a stranger. Removing a
 * friend and withdrawing a request are confirmed first; denying is not, as on the page before.
 *
 * `menuItems` are the relationship's actions for a long-press or header menu. A stranger has none
 * there; asking them stays the page's own button.
 */
export function useFriendActions(user: UserProfile | null | undefined, onUpdated?: (profile: UserProfile) => void) {
    const { credentials } = useAuth();

    const [accepting, accept] = useHappyAction(async () => {
        if (!credentials || !user) return;

        const updatedProfile = await sendFriendRequest(credentials, user.id);
        if (updatedProfile) {
            trackFriendsConnect();
            onUpdated?.(updatedProfile);
            sync.refreshFriends();
            showToast(updatedProfile.status === 'friend'
                ? t('friends.requestAccepted')
                : t('friends.requestSent'));
        } else {
            Modal.alert(t('friends.bothMustHaveGithub'));
        }
    });

    const [removing, remove] = useHappyAction(async () => {
        if (!credentials || !user) return;

        const previousStatus = user.status;

        if (previousStatus === 'friend') {
            const confirmed = await Modal.confirm(
                t('friends.removeFriend'),
                t('friends.removeFriendConfirm', { name: getDisplayName(user) }),
                { confirmText: t('friends.remove'), destructive: true }
            );
            if (!confirmed) return;
        } else if (previousStatus === 'requested') {
            const confirmed = await Modal.confirm(
                t('friends.cancelRequest'),
                t('friends.cancelRequestConfirm', { name: getDisplayName(user) }),
                { confirmText: t('common.yes'), destructive: false }
            );
            if (!confirmed) return;
        }

        const updatedProfile = await removeFriend(credentials, user.id);
        if (updatedProfile) {
            onUpdated?.(updatedProfile);
            sync.refreshFriends();

            // The server drops the friend_request/friend_accepted item with it; so does the inbox.
            const itemToRemove = storage.getState().feedItems.find(item =>
                (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')
                && item.body.uid === user.id
            );
            if (itemToRemove) {
                storage.getState().removeFeedItem(itemToRemove.id);
            }

            showToast(previousStatus === 'friend'
                ? t('friends.friendRemoved')
                : t('friends.requestRejected'));
        }
    });

    const status = user?.status;
    const menuItems = React.useMemo<ActionMenuItem[]>(() => {
        switch (status) {
            case 'pending':
                return [
                    {
                        label: t('friends.acceptRequest'),
                        icon: { ionicon: 'checkmark-circle-outline', sfSymbol: 'checkmark.circle' },
                        onPress: accept,
                    },
                    {
                        label: t('friends.denyRequest'),
                        icon: { ionicon: 'close-circle-outline', sfSymbol: 'xmark.circle' },
                        destructive: true,
                        onPress: remove,
                    },
                ];
            case 'requested':
                return [{
                    label: t('friends.cancelRequest'),
                    icon: { ionicon: 'arrow-undo-outline', sfSymbol: 'arrow.uturn.backward' },
                    onPress: remove,
                }];
            case 'friend':
                return [{
                    label: t('friends.removeFriend'),
                    icon: { ionicon: 'person-remove-outline', sfSymbol: 'person.badge.minus' },
                    destructive: true,
                    onPress: remove,
                }];
            default:
                return [];
        }
    }, [status, accept, remove]);

    return { accept, accepting, remove, removing, menuItems };
}
