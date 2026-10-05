import { Session } from '@/sync/storageTypes';
import { sessionUpdateSummary } from '@/sync/ops';
import { Modal } from '@/modal';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessionUtils';

/**
 * Prompt for a new session title and persist it.
 * Returns true when the title was updated, false when the user cancelled.
 */
export async function promptRenameSession(session: Session): Promise<boolean> {
    if (!session.metadata) return false;

    const result = await Modal.promptWithCheckbox(
        t('sessionInfo.renameSession'),
        t('sessionInfo.renameSessionHint'),
        {
            defaultValue: session.metadata.summary?.text || '',
            placeholder: getSessionName(session),
            cancelText: t('common.cancel'),
            confirmText: t('common.rename'),
            // Titles can be long; give the input more room than the default dialog.
            width: 340,
            checkbox: {
                label: t('sessionInfo.pinSessionTitle'),
                defaultValue: session.metadata.summaryPinned ?? false
            }
        }
    );

    if (result === null) return false;
    const trimmed = result.value.trim();
    if (!trimmed) return false;

    try {
        await sessionUpdateSummary(
            session.id,
            session.metadata,
            trimmed,
            session.metadataVersion,
            result.checked
        );
        return true;
    } catch (error) {
        Modal.alert(
            t('common.error'),
            error instanceof Error ? error.message : t('sessionInfo.failedToRenameSession')
        );
        return false;
    }
}
