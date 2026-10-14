/**
 * Claude Code's usage-limit notice ("You've hit your session limit · resets 7:40am (UTC)").
 *
 * Claude Code writes it as a synthetic assistant message (model `<synthetic>`), and just before it
 * sends a `rate_limit_event` whose `rate_limit_info` is `rejected` and carries `resetsAt` (epoch
 * seconds). The reducer pairs the two, so the notice's reset time comes from the event; the time
 * in the text is only read when no event came with it.
 */

// The two events are written within the same moment; a minute leaves room for clock skew.
export const LIMIT_EVENT_PAIRING_MS = 60_000;

const NOTICE_PATTERN = /^You've hit your (?:[\w-]+ )?limit · resets (.+)$/;
const UTC_TIME_PATTERN = /^(\d{1,2})(?::(\d{2}))?(am|pm) \(UTC\)$/;

/** The reset time of a `rate_limit_event` that turned the request away, or null. */
export function rejectedLimitResetsAt(rateLimitInfo: unknown): number | null {
    if (!rateLimitInfo || typeof rateLimitInfo !== 'object') return null;
    const info = rateLimitInfo as { status?: unknown; resetsAt?: unknown };
    return info.status === 'rejected' && typeof info.resetsAt === 'number' ? info.resetsAt : null;
}

/** Where the reset time starts in a usage-limit notice, or null when the text is not one. */
export function limitNoticeTimeStart(text: string): number | null {
    const match = NOTICE_PATTERN.exec(text);
    return match ? text.length - match[1].length : null;
}

/**
 * The reset time written in the notice, as the first such time after the notice was sent (epoch
 * seconds). Only UTC times without a date are read, the only form seen so far; others give null.
 */
export function parseLimitNoticeResetsAt(text: string, createdAt: number): number | null {
    const start = limitNoticeTimeStart(text);
    if (start === null) return null;
    const match = UTC_TIME_PATTERN.exec(text.slice(start));
    if (!match) return null;
    const hour12 = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const hour = (hour12 % 12) + (match[3] === 'pm' ? 12 : 0);
    const reset = new Date(createdAt);
    reset.setUTCHours(hour, minute, 0, 0);
    if (reset.getTime() <= createdAt) {
        reset.setUTCDate(reset.getUTCDate() + 1);
    }
    return Math.floor(reset.getTime() / 1000);
}

// Pressing a notice's reset time asks the open session view to schedule a message for it.
type ScheduleAtLimitListener = (sessionId: string, endsAt: number) => void;
const listeners = new Set<ScheduleAtLimitListener>();

export function requestScheduleAtLimit(sessionId: string, endsAt: number) {
    for (const listener of listeners) {
        listener(sessionId, endsAt);
    }
}

export function subscribeScheduleAtLimit(listener: ScheduleAtLimitListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
