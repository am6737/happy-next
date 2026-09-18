import { getCurrentLanguage, t } from '@/text';

function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

// Start of the natural week (Monday 00:00) containing `d`.
function startOfWeek(d: Date): Date {
    const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = result.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
    const diffToMonday = (day + 6) % 7; // Mon -> 0, Sun -> 6
    result.setDate(result.getDate() - diffToMonday);
    return result;
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

/**
 * Smart-format a message timestamp (ms) relative to `now`.
 * - today: HH:mm
 * - earlier this week: <localized short weekday> HH:mm
 * - earlier this year: MM-DD HH:mm
 * - earlier years: YYYY-MM-DD
 *
 * `now` and `locale` are injectable for testing; default to real now and the
 * app's current language.
 *
 * Note: timestamps in the future (after `now`) are not classified as "this week"
 * and fall through to the year/date branches.
 */
export function formatMessageTime(
    timestamp: number,
    now: Date = new Date(),
    locale: string = getCurrentLanguage(),
): string {
    const date = new Date(timestamp);
    const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

    if (isSameDay(date, now)) {
        return hm;
    }

    const weekStart = startOfWeek(now);
    if (date.getTime() >= weekStart.getTime() && date.getTime() <= now.getTime()) {
        const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
        return `${weekday} ${hm}`;
    }

    if (date.getFullYear() === now.getFullYear()) {
        return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${hm}`;
    }

    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Full, unabbreviated timestamp for tooltips (e.g. the web `title` attribute).
 * Always includes year, month, day, hour, minute and second in the current
 * locale's format.
 */
export function formatFullMessageTime(
    timestamp: number,
    locale: string = getCurrentLanguage(),
): string {
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(timestamp));
}

/**
 * A duration spelled out in words: `42秒`, `1分钟 42秒`, `1小时 5分钟 42秒`
 * (localized). Empty units are left out, so 1 minute exactly reads `1分钟` rather
 * than `1分钟 0秒`; a whole-zero duration still says `0秒` rather than nothing.
 */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(t('time.durationHours', { count: hours }));
    if (minutes > 0) parts.push(t('time.durationMinutes', { count: minutes }));
    // The seconds are the fallback that keeps the reading non-empty at 0:00.
    if (seconds > 0 || parts.length === 0) parts.push(t('time.durationSeconds', { count: seconds }));
    return parts.join(' ');
}
