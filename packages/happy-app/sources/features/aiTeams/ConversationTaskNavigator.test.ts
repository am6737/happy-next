import { describe, expect, it } from 'vitest';
import { getConversationWorkItems } from './conversationWorkItems';
import type { AiTeamData } from './types';

describe('getConversationWorkItems', () => {
    it('keeps the conversation scope and shows each work item once in recent order', () => {
        const data = {
            workItems: [
                { id: 'older' },
                { id: 'other-conversation' },
                { id: 'newer' },
            ],
            executions: [
                { workItemId: 'older', conversationId: 'target', startedAt: '2026-10-07T10:00:00Z' },
                { workItemId: 'other-conversation', conversationId: 'other', startedAt: '2026-10-07T12:00:00Z' },
                { workItemId: 'newer', conversationId: 'target', startedAt: '2026-10-07T11:00:00Z' },
                { workItemId: 'older', conversationId: 'target', startedAt: '2026-10-07T10:30:00Z' },
            ],
        } as AiTeamData;

        expect(getConversationWorkItems(data, 'target').map((work) => work.id)).toEqual(['newer', 'older']);
    });
});
