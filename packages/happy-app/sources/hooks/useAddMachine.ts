// "Add machine" from the session list: a machine joins the account when its CLI (`happy`) is
// approved by this app. Native scans the QR code the CLI prints; the web cannot scan, so it explains
// how to start the CLI and takes the connection link pasted from the terminal instead.
import * as React from 'react';
import { Platform } from 'react-native';
import { useUnifiedScanner } from '@/hooks/useUnifiedScanner';
import { Modal } from '@/modal';
import { t } from '@/text';

export function useAddMachine(): () => void {
    const { launchScanner, connectWithUrl } = useUnifiedScanner();

    return React.useCallback(() => {
        if (Platform.OS !== 'web') {
            launchScanner();
            return;
        }
        void (async () => {
            const url = await Modal.prompt(
                t('sessionScope.addMachine'),
                t('sessionScope.addMachineWebHint'),
                {
                    placeholder: 'happy://...',
                    cancelText: t('common.cancel'),
                    confirmText: t('common.authenticate'),
                },
            );
            if (url?.trim()) connectWithUrl(url.trim());
        })();
    }, [launchScanner, connectWithUrl]);
}
