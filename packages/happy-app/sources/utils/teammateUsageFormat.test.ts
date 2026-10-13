import { describe, expect, it, vi } from 'vitest';
import { formatTeammateMoney, formatTeammateTokens, teammateCurrencyRate, totalTeammateTokens } from './teammateUsageFormat';

vi.mock('@/text', () => ({ getCurrentLanguage: () => 'en' }));

describe('teammate usage format', () => {
    it('uses yuan for both Chinese languages and dollars elsewhere', () => {
        expect(teammateCurrencyRate('zh-Hans')).toBe(7.2);
        expect(teammateCurrencyRate('zh-Hant')).toBe(7.2);
        expect(formatTeammateMoney(8.1, 'zh-Hans')).toBe('¥58.32');
        expect(formatTeammateMoney(8.1, 'zh-Hant')).toBe('¥58.32');
        expect(formatTeammateMoney(8.1, 'en')).toBe('$8.10');
    });

    it('compacts token counts by language', () => {
        expect(formatTeammateTokens(12000, 'zh-Hans')).toBe('1.2万');
        expect(formatTeammateTokens(13570000, 'zh-Hans')).toBe('1,357万');
        expect(formatTeammateTokens(120000000, 'zh-Hant')).toBe('1.2亿');
        expect(formatTeammateTokens(12300, 'en')).toBe('12.3K');
        expect(formatTeammateTokens(13570000, 'en')).toBe('13.6M');
        expect(totalTeammateTokens({ input: 1200000, cacheRead: 12000000, cacheWrite: 0, output: 370000 })).toBe(13570000);
    });
});
