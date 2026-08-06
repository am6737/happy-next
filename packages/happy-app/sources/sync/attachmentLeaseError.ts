const ATTACHMENT_LEASE_ERROR = 'Invalid or expired attachment lease';

export function isAttachmentLeaseErrorResponse(status: number, body: string): boolean {
    if (status !== 400) return false;
    try {
        const parsed = JSON.parse(body) as { error?: unknown };
        return parsed.error === ATTACHMENT_LEASE_ERROR;
    } catch {
        return false;
    }
}
