import * as React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { isTauriDesktop, openDesktopHtmlPreview } from '@/utils/tauri';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import { setPreviewHtml } from './previewHtmlStore';
import { PreviewHtmlInput } from './previewHtmlInput';

export function useOpenHtmlPreview(input: PreviewHtmlInput | null, sessionId?: string) {
    const router = useRouter();

    return React.useCallback(async () => {
        if (!input) return;

        if (isTauriDesktop()) {
            try {
                await openDesktopHtmlPreview(input.html, input.title);
            } catch (error) {
                console.error('Failed to open desktop HTML preview window:', error);
                showToast(t('status.operationFailed'), { icon: 'alert-circle-outline' });
            }
            return;
        }

        if (Platform.OS === 'web') {
            const win = window.open('', '_blank');
            if (win) {
                win.document.write(input.html);
                win.document.close();
            }
            return;
        }

        if (sessionId) {
            setPreviewHtml(input.html, input.title);
            router.push(`/session/${sessionId}/preview`);
        }
    }, [input, router, sessionId]);
}
