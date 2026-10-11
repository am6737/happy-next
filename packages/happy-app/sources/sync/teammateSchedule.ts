import type { TeammateCreateRequest } from 'happy-wire';

export function buildTeammateSchedulePayload(timezone: string, enabled: boolean, start: string, end: string, days?: number[]):
    Pick<TeammateCreateRequest, 'timezone' | 'activeHours'> {
    return {
        timezone,
        activeHours: enabled ? { start, end, timezone, ...(days ? { days } : {}) } : null,
    };
}
