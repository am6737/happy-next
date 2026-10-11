import { describe, expect, it } from 'vitest';
import { teammateActiveHoursContains, teammateLocalHour } from './teammateActiveHours';

describe('teammate active hours', () => {
    it('uses local timezone and selected weekdays', () => {
        const hours = { start: '09:00', end: '17:00', timezone: 'Asia/Tokyo', days: [1] };
        expect(teammateActiveHoursContains(hours, new Date('2026-10-12T00:30:00Z'))).toBe(true);
        expect(teammateActiveHoursContains(hours, new Date('2026-10-11T00:30:00Z'))).toBe(false);
        expect(teammateLocalHour('Asia/Tokyo', new Date('2026-10-12T00:30:00Z'))).toBe(9);
    });

    it('attributes after-midnight hours to the starting day', () => {
        const hours = { start: '22:00', end: '02:00', timezone: 'UTC', days: [1] };
        expect(teammateActiveHoursContains(hours, new Date('2026-10-12T23:00:00Z'))).toBe(true);
        expect(teammateActiveHoursContains(hours, new Date('2026-10-13T01:00:00Z'))).toBe(true);
        expect(teammateActiveHoursContains(hours, new Date('2026-10-13T23:00:00Z'))).toBe(false);
        expect(teammateActiveHoursContains(null, new Date())).toBe(true);
    });
});
