import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { AttachmentContent } from './typesRaw';
import type { LocalAttachment } from '@/components/AttachmentPreview';
import { attachmentArrayBuffer, encryptAttachmentBytes, normalizeAttachmentMetadata } from './attachmentCrypto';
import { getAttachmentKind } from './attachmentMime';

const MAX_PLAINTEXT_SIZE = 25 * 1024 * 1024;

async function readAttachmentBytes(uri: string): Promise<Uint8Array> {
    if (Platform.OS === 'web') {
        const response = await fetch(uri);
        if (!response.ok) throw new Error('Unable to read attachment');
        return new Uint8Array(await response.arrayBuffer());
    }
    return new File(uri).bytes();
}

export async function uploadChatAttachment(
    sessionId: string,
    attachment: LocalAttachment,
    token: string,
    apiUrl: string,
): Promise<AttachmentContent> {
    const metadata = normalizeAttachmentMetadata(attachment.name, attachment.mimeType);
    const plaintext = await readAttachmentBytes(attachment.uri);
    if (plaintext.length > MAX_PLAINTEXT_SIZE) throw new Error('Attachment exceeds 25 MB');
    const encrypted = await encryptAttachmentBytes(plaintext);
    const formData = new FormData();
    let temporaryFile: File | null = null;
    if (Platform.OS === 'web') {
        formData.append('file', new Blob([attachmentArrayBuffer(encrypted.ciphertext)], { type: 'application/octet-stream' }), 'attachment.bin');
    } else {
        temporaryFile = new File(Paths.cache, `happy-attachment-${randomUUID()}.bin`);
        temporaryFile.write(encrypted.ciphertext);
        formData.append('file', {
            uri: temporaryFile.uri,
            name: 'attachment.bin',
            type: 'application/octet-stream',
        } as any);
    }
    try {
        const uploadUrl = `${apiUrl}/v1/chat/sessions/${encodeURIComponent(sessionId)}/upload-attachment?size=${encrypted.ciphertext.length}`;
        const response = await fetch(uploadUrl, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || `Upload failed: ${response.status}`);
        if (typeof result.data?.id !== 'string' || result.data.ciphertextSize !== encrypted.ciphertext.length) {
            throw new Error('Invalid attachment upload response');
        }
        return {
            v: 2,
            id: result.data.id,
            kind: getAttachmentKind(metadata.mimeType),
            name: metadata.name,
            mimeType: metadata.mimeType,
            size: plaintext.length,
            ...(attachment.image ? { image: attachment.image } : {}),
            encryption: {
                algorithm: 'secretbox',
                key: encrypted.key,
                nonce: encrypted.nonce,
                plaintextSha256: encrypted.plaintextSha256,
                ciphertextSize: encrypted.ciphertext.length,
            },
        };
    } finally {
        if (temporaryFile?.exists) temporaryFile.delete();
    }
}
