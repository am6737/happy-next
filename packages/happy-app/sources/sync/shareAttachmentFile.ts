import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { AttachmentContent } from './typesRaw';

export async function shareAttachmentFile(attachment: AttachmentContent, plaintext: Uint8Array): Promise<void> {
    const safeName = attachment.name.replace(/[^a-zA-Z0-9._ -]/g, '_');
    const temporaryFile = new File(Paths.cache, `${attachment.id}-${safeName}`);

    try {
        temporaryFile.write(plaintext);
        await Sharing.shareAsync(temporaryFile.uri, { mimeType: attachment.mimeType });
    } finally {
        try {
            if (temporaryFile.exists) temporaryFile.delete();
        } catch {
            // Cleanup errors must not hide the download or sharing error.
        }
    }
}
