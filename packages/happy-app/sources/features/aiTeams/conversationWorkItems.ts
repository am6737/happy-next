import type { AiTeamData, AiWorkItem } from './types';

export function getConversationWorkItems(data: AiTeamData, conversationId: string): AiWorkItem[] {
    const executionTime = new Map<string, number>();
    for (const execution of data.executions) {
        if (execution.conversationId !== conversationId) continue;
        const time = Date.parse(execution.startedAt) || 0;
        executionTime.set(execution.workItemId, Math.max(executionTime.get(execution.workItemId) ?? 0, time));
    }
    return data.workItems
        .filter((work) => executionTime.has(work.id))
        .sort((a, b) => (executionTime.get(b.id) ?? 0) - (executionTime.get(a.id) ?? 0));
}
