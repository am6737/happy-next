import * as React from 'react';
import { Platform } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/modal';
import { t } from '@/text';
import { discardSharedFiles, receiveSharedContent, toSharedContent, useSharedContentStore } from './sharedContent';

/**
 * Takes what another app shared through the system share sheet and opens the share-target page,
 * where it is sent to a new session or an active one. On iOS the share extension opens the app
 * with a link that already leads to that page (+native-intent); Android hands over an intent, so
 * the page is opened here.
 */
export const ShareIntentReceiver = React.memo(() => {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
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
        resetShareIntent();
        if (!content) return;
        if (!isAuthenticated) {
            discardSharedFiles(content.files);
            Modal.alert(t('shareTarget.title'), t('shareTarget.loginRequired'));
            return;
        }
        receiveSharedContent(content);
        if (!useSharedContentStore.getState().pageOpen) {
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
