import * as React from 'react';
import { Platform } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useAuth } from '@/auth/AuthContext';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useShareExtensionSnapshot } from '@/hooks/useShareExtensionSnapshot';
import { Modal } from '@/modal';
import { t } from '@/text';
import { discardSharedFiles, receiveSharedContent, toSharedContent, useSharedContentStore } from './sharedContent';
import { takeShareExtensionTarget } from './shareExtension';

/**
 * Takes what another app shared through the system share sheet to where it goes. On iOS the share
 * extension's sheet has the user pick a new session or an active one (from the snapshot kept up
 * to date here), so that composer opens right away; Android, and iOS without a snapshot, open the
 * share-target page to pick there.
 */
export const ShareIntentReceiver = React.memo(() => {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const navigateToSession = useNavigateToSession();
    useShareExtensionSnapshot(isAuthenticated);
    const lastShare = React.useRef<{ signature: string; at: number } | null>(null);
    // On a cold start the share arrives before the navigator can take a page
    const navigationReady = !!useRootNavigationState()?.key;
    const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({
        disabled: Platform.OS === 'web',
        // Taken into the app's own store as soon as it arrives, so nothing is left to reset
        resetOnBackground: false,
    });

    React.useEffect(() => {
        if (!hasShareIntent || !navigationReady) return;
        const content = toSharedContent(shareIntent);
        const target = takeShareExtensionTarget();
        resetShareIntent();
        if (!content) return;
        // iOS can hand the same share over twice (the link and the app coming to the front both
        // read it) before it is cleared; the second has no target left and the same files
        const signature = JSON.stringify(content);
        const now = Date.now();
        if (lastShare.current?.signature === signature && now - lastShare.current.at < 10_000) return;
        lastShare.current = { signature, at: now };
        if (!isAuthenticated) {
            discardSharedFiles(content.files);
            Modal.alert(t('shareTarget.title'), t('shareTarget.loginRequired'));
            return;
        }
        receiveSharedContent(content, target);
        if (target?.type === 'new') {
            router.navigate('/new', { dangerouslySingular: () => 'new' });
        } else if (target) {
            navigateToSession(target.sessionId);
        } else if (!useSharedContentStore.getState().pageOpen) {
            router.push('/share-target');
        }
        // Runs once per share; the intent is reset right away
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasShareIntent, navigationReady]);

    React.useEffect(() => {
        if (error) console.warn('[ShareIntent]', error);
    }, [error]);

    return null;
});
