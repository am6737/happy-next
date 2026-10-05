import { describe, it, expect, vi } from 'vitest';

vi.mock('@/text', () => ({
    getCurrentLanguage: () => 'en',
    // Mirrors the `time.duration*` entries of the English translations, which
    // `formatDuration` composes into one string.
    t: (key: string, params: { count: number }) => {
        const units: Record<string, string> = {
            'time.durationSeconds': 's',
            'time.durationMinutes': 'm',
            'time.durationHours': 'h',
        };
        return `${params.count}${units[key]}`;
    },
}));

import { formatDuration, formatMessageTime } from './messageTime';

// Fixed "now": Wednesday 2026-05-20 12:00 local time
const NOW = new Date(2026, 4, 20, 12, 0, 0);

describe('formatMessageTime', () => {
    it('shows HH:mm for a timestamp earlier today', () => {
        const ts = new Date(2026, 4, 20, 9, 5, 0).getTime();
        expect(formatMessageTime(ts, NOW, 'en')).toBe('09:05');
    });

    it('shows weekday + HH:mm for an earlier day in the same week', () => {
        // Monday 2026-05-18 08:30 (same Mon–Sun week as Wed NOW)
        const ts = new Date(2026, 4, 18, 8, 30, 0).getTime();
        const result = formatMessageTime(ts, NOW, 'en');
        expect(result).toBe('Mon 08:30');
    });

    it('shows MM-DD HH:mm for an earlier date in the same year', () => {
        const ts = new Date(2026, 2, 15, 14, 30, 0).getTime();
        expect(formatMessageTime(ts, NOW, 'en')).toBe('03-15 14:30');
    });

    it('shows YYYY-MM-DD for a date in a previous year', () => {
        const ts = new Date(2024, 11, 1, 14, 30, 0).getTime();
        expect(formatMessageTime(ts, NOW, 'en')).toBe('2024-12-01');
    });

    it('localizes the weekday name', () => {
        const ts = new Date(2026, 4, 18, 8, 30, 0).getTime();
        // zh short weekday for Monday is 周一
        expect(formatMessageTime(ts, NOW, 'zh-Hans')).toBe('周一 08:30');
    });

    it('Sunday NOW: Monday of that week is still "this week"', () => {
        // NOW = Sunday 2026-05-24; (day+6)%7 gives 6, so weekStart = Mon 2026-05-18
        const SUN_NOW = new Date(2026, 4, 24, 12, 0, 0);
        const ts = new Date(2026, 4, 18, 8, 30, 0).getTime();
        expect(formatMessageTime(ts, SUN_NOW, 'en')).toBe('Mon 08:30');
    });

    it('shows 00:00 for a timestamp at midnight the same day', () => {
        const NOON_NOW = new Date(2026, 4, 20, 12, 0, 0);
        const ts = new Date(2026, 4, 20, 0, 0, 0).getTime();
        expect(formatMessageTime(ts, NOON_NOW, 'en')).toBe('00:00');
    });
});

describe('formatDuration', () => {
    it('spells out the units, largest first', () => {
        expect(formatDuration(0)).toBe('0s');
        expect(formatDuration(42_000)).toBe('42s');
        expect(formatDuration(102_000)).toBe('1m 42s');
        expect(formatDuration(3_600_000 + 5 * 60_000 + 42_000)).toBe('1h 5m 42s');
    });

    it('leaves empty units out', () => {
        expect(formatDuration(60_000)).toBe('1m');
        expect(formatDuration(3_600_000)).toBe('1h');
        expect(formatDuration(3_600_000 + 42_000)).toBe('1h 42s');
        expect(formatDuration(3_600_000 + 5 * 60_000)).toBe('1h 5m');
    });

    it('floors to whole seconds and never goes negative', () => {
        expect(formatDuration(1_999)).toBe('1s');
        expect(formatDuration(-5_000)).toBe('0s');
    });
});
