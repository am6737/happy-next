import type { AuthCredentials } from '@/auth/tokenStorage';
import type { AiAgent, AiAgentSettings, AiTeam, AiTeamData } from 'happy-wire';
import { getServerUrl } from './serverConfig';

type AgentInput = Pick<AiAgent, 'name' | 'role' | 'description' | 'emoji' | 'skills' | 'responsibilities'> & {
    settings: AiAgentSettings;
    enabled: boolean;
};

type TeamInput = Pick<AiTeam, 'name' | 'description' | 'emoji' | 'leaderId' | 'memberIds' | 'instructions' | 'currentGoal'>;

function headers(credentials: AuthCredentials) {
    return { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' };
}

async function request<T>(credentials: AuthCredentials, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${getServerUrl()}${path}`, { ...init, headers: { ...headers(credentials), ...init?.headers } });
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `AI team request failed: ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

export function fetchAiTeamState(credentials: AuthCredentials): Promise<AiTeamData> {
    return request(credentials, '/v1/ai-team/state');
}

export function createAiAgent(credentials: AuthCredentials, input: AgentInput): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/agents', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAiAgent(credentials: AuthCredentials, id: string, input: AgentInput): Promise<void> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function duplicateAiAgent(credentials: AuthCredentials, id: string): Promise<{ id: string }> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
}

export function deleteAiAgent(credentials: AuthCredentials, id: string): Promise<void> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function createAiTeam(credentials: AuthCredentials, input: TeamInput): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/teams', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAiTeam(credentials: AuthCredentials, id: string, input: TeamInput): Promise<void> {
    return request(credentials, `/v1/ai-team/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteAiTeam(credentials: AuthCredentials, id: string): Promise<void> {
    return request(credentials, `/v1/ai-team/teams/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function ensureAiConversation(credentials: AuthCredentials, input: { agentId: string; teamId?: string | null }): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/conversations', { method: 'POST', body: JSON.stringify(input) });
}

export function createAiAssignment(credentials: AuthCredentials, input: {
    agentId: string;
    teamId?: string;
    conversationId?: string;
    title: string;
    summary: string;
    sourceType?: 'github' | 'dootask' | 'session' | 'execution';
    sourceLabel?: string;
    sourceResourceId?: string;
}): Promise<{ workItemId: string; executionId: string; conversationId: string; runId: string }> {
    return request(credentials, '/v1/ai-team/assignments', { method: 'POST', body: JSON.stringify(input) });
}

export function sendAiConversationMessage(credentials: AuthCredentials, conversationId: string, text: string) {
    return request<{ workItemId: string; executionId: string; conversationId: string; runId: string }>(credentials, `/v1/ai-team/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
}

export function updateAiWorkAcceptance(credentials: AuthCredentials, workItemId: string, status: 'approved' | 'changes_requested', note?: string): Promise<void> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/acceptance`, { method: 'POST', body: JSON.stringify({ status, note }) });
}
