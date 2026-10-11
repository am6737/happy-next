function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readSessionId(value: unknown): string | null {
    const sessionId = asRecord(value)?.sessionId;
    return typeof sessionId === 'string' ? sessionId : null;
}

export function getNotificationSessionId(data: unknown): string | null {
    const directSessionId = readSessionId(data);
    if (directSessionId) {
        return directSessionId;
    }

    const nestedData = asRecord(data)?.data;
    if (typeof nestedData !== 'string') {
        return readSessionId(nestedData);
    }

    try {
        return readSessionId(JSON.parse(nestedData));
    } catch {
        return null;
    }
}

export function getNotificationChannelId(data: unknown): string | null {
    const direct = asRecord(data);
    if (direct?.type === 'teammate-channel' && typeof direct.channelId === 'string' && direct.channelId) return direct.channelId;
    const nested = direct?.data;
    if (typeof nested === 'string') {
        try { return getNotificationChannelId(JSON.parse(nested)); } catch { return null; }
    }
    const payload = asRecord(nested);
    return payload?.type === 'teammate-channel' && typeof payload.channelId === 'string' && payload.channelId ? payload.channelId : null;
}
