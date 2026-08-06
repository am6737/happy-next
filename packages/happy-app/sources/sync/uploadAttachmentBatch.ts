import type { LocalAttachment } from '@/components/AttachmentPreview';
import type { AttachmentContent } from './typesRaw';

export type PreparedAttachmentUpload = {
    fingerprint: string;
    attachments: AttachmentContent[];
};

export async function uploadAttachmentBatch(input: {
    attachments: LocalAttachment[];
    fingerprint: string;
    cached?: PreparedAttachmentUpload;
    upload: (attachment: LocalAttachment) => Promise<AttachmentContent>;
    onProgress: (progress: PreparedAttachmentUpload) => void;
}): Promise<AttachmentContent[]> {
    const uploaded = input.cached?.fingerprint === input.fingerprint
        ? input.cached.attachments.slice(0, input.attachments.length)
        : [];

    for (let index = uploaded.length; index < input.attachments.length; index += 1) {
        uploaded.push(await input.upload(input.attachments[index]));
        input.onProgress({
            fingerprint: input.fingerprint,
            attachments: [...uploaded],
        });
    }

    return uploaded;
}
