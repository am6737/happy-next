import type { TeammateActiveHours } from 'happy-wire';

function localParts(timezone: string, now: Date): { hour: number; minute: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now);
    const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    return { hour: Number(value('hour')), minute: Number(value('minute')), day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday')) };
}

/** Return the local hour in an IANA timezone. */
export function teammateLocalHour(timezone: string, now: Date): number { return localParts(timezone, now).hour; }

/** Check local day and time, treating the after-midnight part of an overnight range as the prior day. */
export function teammateActiveHoursContains(activeHours: TeammateActiveHours | null, now: Date): boolean {
    if (!activeHours) return true;
    const { hour, minute, day } = localParts(activeHours.timezone, now);
    const current = hour * 60 + minute;
    const [startHour, startMinute] = activeHours.start.split(':').map(Number);
    const [endHour, endMinute] = activeHours.end.split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    const allowed = (value: number) => !activeHours.days || activeHours.days.includes(value);
    if (start <= end) return allowed(day) && current >= start && current < end;
    return (current >= start && allowed(day)) || (current < end && allowed((day + 6) % 7));
}
