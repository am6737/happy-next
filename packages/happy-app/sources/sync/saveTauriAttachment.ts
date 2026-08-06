import type { AttachmentContent } from './typesRaw';

export function isTauriDesktop(): boolean {
    return typeof window !== 'undefined' && (
        Boolean((globalThis as any).isTauri)
        || (window as any).__TAURI_INTERNALS__ !== undefined
    );
}

export function sanitizeAttachmentFilename(name: string): string {
    const sanitized = name
        .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/g, '_')
        .trim()
        .replace(/[. ]+$/g, '');

    if (!sanitized) return 'attachment';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(sanitized)) {
        return `_${sanitized}`;
    }
    return sanitized;
}

export async function saveTauriAttachment(
    attachment: AttachmentContent,
    plaintext: Uint8Array,
): Promise<void> {
    const [{ save }, { writeFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
    ]);
    const path = await save({ defaultPath: sanitizeAttachmentFilename(attachment.name) });

    if (path) await writeFile(path, plaintext);
}
