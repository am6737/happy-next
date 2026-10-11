import { TeammateError } from './teammateError';

/** Reject malformed IANA timezones before writing a teammate profile. */
export function teammateTimezoneValidate(timezone: string | null | undefined): void {
    if (timezone == null) return;
    try { new Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
    catch { throw new TeammateError('invalid_timezone'); }
}
