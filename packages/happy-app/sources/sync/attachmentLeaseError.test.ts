import { describe, expect, it } from 'vitest';
import { isAttachmentLeaseErrorResponse } from './attachmentLeaseError';

describe('isAttachmentLeaseErrorResponse', () => {
    it('recognizes the server attachment lease rejection', () => {
        expect(isAttachmentLeaseErrorResponse(400, JSON.stringify({
            error: 'Invalid or expired attachment lease',
        }))).toBe(true);
    });

    it('does not match unrelated failures', () => {
        expect(isAttachmentLeaseErrorResponse(400, '{"error":"Invalid request"}')).toBe(false);
        expect(isAttachmentLeaseErrorResponse(500, '{"error":"Invalid or expired attachment lease"}')).toBe(false);
        expect(isAttachmentLeaseErrorResponse(400, 'not json')).toBe(false);
    });
});
