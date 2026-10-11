import { describe, expect, it } from 'vitest';
import { buildTeammateSchedulePayload } from './teammateSchedule';

describe('teammate schedule payload', () => {
    it('keeps the independent timezone when active hours are disabled', () => {
        expect(buildTeammateSchedulePayload('Asia/Shanghai', false, '09:00', '18:00')).toEqual({ timezone: 'Asia/Shanghai', activeHours: null });
    });
    it('mirrors timezone to active hours and preserves selected days', () => {
        expect(buildTeammateSchedulePayload('Europe/Rome', true, '22:00', '06:00', [1, 3])).toEqual({
            timezone: 'Europe/Rome', activeHours: { timezone: 'Europe/Rome', start: '22:00', end: '06:00', days: [1, 3] },
        });
    });
});
