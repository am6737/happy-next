import type {
    AiAgent,
    AiAgentSettings,
    AiChatMessage,
    AiConversation,
    AiExecution,
    AiExecutionEvent,
    AiTeam,
    AiTeamData,
    AiWorkItem,
} from 'happy-wire';

export type {
    AiAgent,
    AiAgentSettings,
    AiChatMessage,
    AiConversation,
    AiExecution,
    AiExecutionEvent,
    AiTeam,
    AiTeamData,
    AiWorkItem,
};

export type AiAgentStatus = AiAgent['status'];
export type AiWorkStatus = AiWorkItem['status'];
export type AiWorkSource = AiWorkItem['sourceType'];
export type AiExecutionStatus = AiExecution['status'];
export type AiExecutionEventKind = AiExecutionEvent['kind'];
export type AiAcceptanceStatus = NonNullable<AiWorkItem['acceptanceStatus']>;
export type AiAgentEngine = AiAgentSettings['engine'];
export type AiAgentPermissionMode = AiAgentSettings['permissionMode'];

export function findAiAgent(data: AiTeamData, id: string): AiAgent | undefined {
    return data.agents.find((agent) => agent.id === id);
}

export function findAiTeam(data: AiTeamData, id: string): AiTeam | undefined {
    return data.teams.find((team) => team.id === id);
}

export function findAiWorkItem(data: AiTeamData, id: string): AiWorkItem | undefined {
    return data.workItems.find((item) => item.id === id);
}

export function findAiExecution(data: AiTeamData, id: string): AiExecution | undefined {
    return data.executions.find((execution) => execution.id === id);
}

export function findAiExecutionsForWork(data: AiTeamData, workItemId: string): AiExecution[] {
    return data.executions.filter((execution) => execution.workItemId === workItemId).sort((a, b) => b.attempt - a.attempt);
}

export function getAiWorkSourcePath(work: AiWorkItem): string | null {
    if (work.sourceType === 'github') {
        const match = work.sourceResourceId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        return match ? `/repos/${match[1]}/${match[2]}/issue/${match[3]}` : null;
    }
    if (work.sourceType === 'dootask') return `/dootask/${work.sourceResourceId}`;
    if (work.sourceType === 'session') return `/session/${work.sourceResourceId}`;
    const executionId = work.executionIds.at(-1);
    return executionId ? `/inbox/ai/executions/${executionId}` : null;
}
