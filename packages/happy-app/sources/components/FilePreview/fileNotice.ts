import { t } from '@/text';

/**
 * The version label a file screen can show before the file is read, derived from the params the
 * entry was opened with. The list it was tapped from already knows whether it came from the staged
 * section or from a commit, so the header subtitle does not have to wait for an RPC to say so.
 * The loaded metadata replaces this guess once it arrives.
 */
export function fileRouteNotice(params: {
    note?: string;
    ref?: string;
    staged?: boolean;
}): string | null {
    if (params.note) return params.note;
    if (params.ref) return `${t('files.preview.commit')} ${params.ref.slice(0, 8)}`;
    return params.staged ? t('files.preview.index') : null;
}
