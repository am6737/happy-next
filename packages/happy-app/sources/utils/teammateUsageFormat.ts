import type { TeammateTokenUsage } from 'happy-wire';
import { getCurrentLanguage, type SupportedLanguage } from '@/text';

export const USD_TO_CNY = 7.2;

export function teammateCurrencyRate(language: SupportedLanguage = getCurrentLanguage()): number {
    return language === 'zh-Hans' || language === 'zh-Hant' ? USD_TO_CNY : 1;
}

export function teammateCurrencySymbol(language: SupportedLanguage = getCurrentLanguage()): string {
    return teammateCurrencyRate(language) === 1 ? '$' : '¥';
}

export function formatTeammateMoney(usd: number, language: SupportedLanguage = getCurrentLanguage()): string {
    const amount = usd * teammateCurrencyRate(language);
    return `${teammateCurrencySymbol(language)}${amount.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTeammateTokens(tokens: number, language: SupportedLanguage = getCurrentLanguage()): string {
    const chinese = teammateCurrencyRate(language) !== 1;
    const units: [number, string][] = chinese ? [[1e8, '亿'], [1e4, '万']] : [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const unit = units.find(([size]) => tokens >= size);
    if (!unit) return tokens.toLocaleString(language);
    const [size, suffix] = unit;
    const scaled = tokens / size;
    return `${scaled.toLocaleString(language, { minimumFractionDigits: 0, maximumFractionDigits: scaled >= 100 ? 0 : 1 })}${suffix}`;
}

export function totalTeammateTokens(tokens: TeammateTokenUsage): number {
    return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output;
}
