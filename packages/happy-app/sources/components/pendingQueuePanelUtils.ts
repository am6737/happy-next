export function getPendingPreviewText(previewText: string, emptyLabel: string): string {
    const text = previewText.trim();
    if (text.length === 0) {
        return emptyLabel;
    }
    return text;
}

export function truncatePendingPreview(previewText: string, maxLength = 140): string {
    if (previewText.length <= maxLength) {
        return previewText;
    }
    return `${previewText.slice(0, maxLength)}…`;
}

// Describes a scheduled message for display: its formatted time and whether that time
// has already passed (the message is then only waiting for the session to take it,
// e.g. the CLI is offline or a turn is still running). Null for unscheduled messages.
export function getPendingScheduleInfo(deliverAt: number | null, now = Date.now()): { due: boolean; time: string } | null {
    if (deliverAt === null) {
        return null;
    }
    return {
        due: deliverAt <= now,
        time: new Date(deliverAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    };
}

// Time left until a scheduled message goes out, in its single largest unit: 3″, 3′, 3h, 3d.
// Null once the time has come (the message is waiting on the queue, not the clock).
export function formatScheduleCountdown(deliverAt: number, now = Date.now()): string | null {
    const seconds = Math.ceil((deliverAt - now) / 1000);
    if (seconds <= 0) return null;
    if (seconds < 60) return `${seconds}″`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}′`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}
