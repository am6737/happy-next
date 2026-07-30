import type { NormalizedMessage } from '@/sync/typesRaw';
import { formatMessagePreviewText } from '@/utils/messagePreviewText';

export function sessionIdFromPath(pathname: string | null): string | null {
    const match = pathname?.match(/\/session\/([^/]+)/);
    if (!match) {
        return null;
    }
    const id = decodeURIComponent(match[1]);
    return id === 'recent' || id === 'claude' ? null : id;
}

export function agentMessagePreview(message: NormalizedMessage): string | null {
    if (message.role !== 'agent') {
        return null;
    }

    const text = message.content
        .filter((item): item is Extract<(typeof message.content)[number], { type: 'text' }> => item.type === 'text')
        .map((item) => formatMessagePreviewText(item.text))
        .filter(Boolean)
        .join(' ');
    return text || null;
}

export function otherUserMessagePreview(message: NormalizedMessage, currentUserId: string | null): string | null {
    if (message.role !== 'user' || !message.sentBy || message.sentBy === currentUserId) {
        return null;
    }
    return formatMessagePreviewText(message.content.text) || 'New message';
}

export function isReadyEvent(message: NormalizedMessage): boolean {
    return message.role === 'event' && message.content.type === 'ready';
}

export function notificationId(sessionId: string): number {
    let hash = 0;
    for (let index = 0; index < sessionId.length; index += 1) {
        hash = ((hash << 5) - hash + sessionId.charCodeAt(index)) | 0;
    }
    return (hash & 0x7fffffff) || 1;
}
