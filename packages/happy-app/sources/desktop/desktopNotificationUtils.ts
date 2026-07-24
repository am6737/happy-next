import type { NormalizedMessage } from '@/sync/typesRaw';

function notificationText(text: string): string {
    return text.trim().replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ');
}

export function sessionIdFromPath(pathname: string | null): string | null {
    const match = pathname?.match(/\/session\/([^/]+)/);
    if (!match) {
        return null;
    }
    const id = decodeURIComponent(match[1]);
    return id === 'recent' || id === 'claude' ? null : id;
}

export function messagePreview(message: NormalizedMessage, currentUserId: string | null): string | null {
    if (message.role === 'user') {
        if (!message.sentBy || message.sentBy === currentUserId) {
            return null;
        }
        return notificationText(message.content.text) || 'New message';
    }

    if (message.role !== 'agent') {
        return null;
    }

    const text = message.content
        .filter((item): item is Extract<(typeof message.content)[number], { type: 'text' }> => item.type === 'text')
        .map((item) => notificationText(item.text))
        .filter(Boolean)
        .join(' ');
    return text || null;
}

export function notificationId(sessionId: string): number {
    let hash = 0;
    for (let index = 0; index < sessionId.length; index += 1) {
        hash = ((hash << 5) - hash + sessionId.charCodeAt(index)) | 0;
    }
    return (hash & 0x7fffffff) || 1;
}
