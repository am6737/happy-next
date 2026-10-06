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
