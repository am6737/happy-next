import { describe, expect, it } from 'vitest';
import { getPendingPreviewText, getPendingScheduleInfo, truncatePendingPreview } from './pendingQueuePanelUtils';

describe('pendingQueuePanelUtils', () => {
    it('uses fallback label when preview text is empty', () => {
        expect(getPendingPreviewText('', 'fallback')).toBe('fallback');
        expect(getPendingPreviewText('   ', 'fallback')).toBe('fallback');
    });

    it('returns trimmed preview when preview text is present', () => {
        expect(getPendingPreviewText('  hello world  ', 'fallback')).toBe('hello world');
    });

    it('truncates long preview with ellipsis', () => {
        expect(truncatePendingPreview('1234567890', 10)).toBe('1234567890');
        expect(truncatePendingPreview('12345678901', 10)).toBe('1234567890…');
    });

    it('describes scheduled messages and flags the ones whose time has passed', () => {
        expect(getPendingScheduleInfo(null, 1000)).toBeNull();
        expect(getPendingScheduleInfo(2000, 1000)).toMatchObject({ due: false });
        expect(getPendingScheduleInfo(1000, 1000)).toMatchObject({ due: true });
        expect(getPendingScheduleInfo(500, 1000)).toMatchObject({ due: true });
    });
});
