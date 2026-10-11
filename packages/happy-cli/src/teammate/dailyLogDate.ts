/** Format a local calendar date, consistently for log writing and prompt loading. */
export function dailyLogDate(at: Date): string {
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}
