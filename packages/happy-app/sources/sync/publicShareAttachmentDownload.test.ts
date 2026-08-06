import { describe, expect, it, vi } from 'vitest';
import {
    createAttachmentRequestLimiter,
    downloadPublicShareAttachmentBytes,
    parseRetryAfterMs,
} from './publicShareAttachmentDownload';

describe('public share attachment downloads', () => {
    it('retries 429 responses using Retry-After before returning the attachment', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('limited', {
                status: 429,
                headers: { 'Retry-After': '2' },
            }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
        const sleepMock = vi.fn().mockResolvedValue(undefined);

        await expect(downloadPublicShareAttachmentBytes('https://example.test/attachment', {}, {
            fetch: fetchMock,
            limiter: createAttachmentRequestLimiter(1),
            random: () => 0,
            sleep: sleepMock,
        })).resolves.toEqual(new Uint8Array([1, 2, 3]));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sleepMock).toHaveBeenCalledWith(2000, undefined);
    });

    it('does not retry non-rate-limit failures', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
        const sleepMock = vi.fn().mockResolvedValue(undefined);

        await expect(downloadPublicShareAttachmentBytes('https://example.test/attachment', {}, {
            fetch: fetchMock,
            limiter: createAttachmentRequestLimiter(1),
            sleep: sleepMock,
        })).rejects.toThrow('Download failed: 403');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sleepMock).not.toHaveBeenCalled();
    });

    it('sends the counted public-share access credential', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

        await downloadPublicShareAttachmentBytes('https://example.test/attachment', {
            resourceAccessToken: 'resource-token',
        }, {
            fetch: fetchMock,
            limiter: createAttachmentRequestLimiter(1),
        });

        expect(fetchMock).toHaveBeenCalledWith('https://example.test/attachment', expect.objectContaining({
            headers: { 'X-Public-Share-Access': 'resource-token' },
        }));
    });

    it('bounds simultaneous attachment requests', async () => {
        const limiter = createAttachmentRequestLimiter(2);
        let active = 0;
        let peak = 0;
        const releases: Array<() => void> = [];
        const tasks = Array.from({ length: 5 }, () => limiter.run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) => releases.push(resolve));
            active -= 1;
        }));

        await vi.waitFor(() => expect(releases).toHaveLength(2));
        while (releases.length > 0) {
            releases.shift()?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await Promise.all(tasks);

        expect(peak).toBe(2);
    });

    it('parses both delta-seconds and HTTP date Retry-After values', () => {
        const now = Date.parse('2026-07-31T00:00:00.000Z');
        expect(parseRetryAfterMs('1.5', now)).toBe(1500);
        expect(parseRetryAfterMs('Fri, 31 Jul 2026 00:00:03 GMT', now)).toBe(3000);
        expect(parseRetryAfterMs('invalid', now)).toBeNull();
    });
});
