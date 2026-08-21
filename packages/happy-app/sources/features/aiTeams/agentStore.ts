import * as React from 'react';
import { getCurrentAuth, useAuth } from '@/auth/AuthContext';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    createAiAgent,
    createAiAssignment,
    createAiTeam,
    deleteAiAgent,
    deleteAiTeam,
    duplicateAiAgent,
    ensureAiConversation,
    fetchAiTeamState,
    sendAiConversationMessage,
    updateAiAgent,
    updateAiTeam,
    updateAiWorkAcceptance,
} from '@/sync/apiAiTeams';
import { applyAiAgentDraft, type AiAgentDraft } from './agentDefinition';
import type { AiAgent, AiConversation, AiTeam, AiTeamData } from './types';

const emptyData: AiTeamData = {
    agents: [],
    teams: [],
    workItems: [],
    executions: [],
    conversations: [],
    messages: {},
};

let data: AiTeamData = emptyData;
let revision = 0;
let pendingRefresh: Promise<AiTeamData> | null = null;
const listeners = new Set<() => void>();

function emit(next: AiTeamData) {
    data = next;
    revision += 1;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getRevision() {
    return revision;
}

function credentials() {
    const value = getCurrentAuth()?.credentials;
    if (!value) throw new Error('Authentication is required');
    return value;
}

export async function refreshManagedAiTeamData(authCredentials?: AuthCredentials): Promise<AiTeamData> {
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = fetchAiTeamState(authCredentials ?? credentials())
        .then((next) => {
            emit(next);
            return next;
        })
        .finally(() => {
            pendingRefresh = null;
        });
    return pendingRefresh;
}

export function getManagedAiTeamData(): AiTeamData {
    return data;
}

export function useManagedAiTeamData(): AiTeamData {
    const auth = useAuth();
    React.useSyncExternalStore(subscribe, getRevision, getRevision);
    React.useEffect(() => {
        if (!auth.credentials) return;
        let active = true;
        const refresh = () => refreshManagedAiTeamData(auth.credentials!).catch((error) => {
            if (active) console.warn('Failed to refresh AI team data', error);
        });
        void refresh();
        const timer = setInterval(refresh, 3_000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [auth.credentials]);
    return data;
}

function agentInput(agent: AiAgent) {
    return {
        name: agent.name,
        role: agent.role,
        description: agent.description,
        emoji: agent.emoji,
        skills: agent.skills,
        responsibilities: agent.responsibilities,
        settings: agent.settings,
        enabled: agent.enabled !== false,
    };
}

function teamInput(team: AiTeam) {
    return {
        name: team.name,
        description: team.description,
        emoji: team.emoji,
        leaderId: team.leaderId,
        memberIds: team.memberIds,
        instructions: team.instructions,
        currentGoal: team.currentGoal,
    };
}

export async function saveManagedAiAgent(agent: AiAgent): Promise<void> {
    await updateAiAgent(credentials(), agent.id, agentInput(agent));
    await refreshManagedAiTeamData();
}

export async function createManagedAiAgent(draft: AiAgentDraft, isZh: boolean): Promise<AiAgent> {
    const template = applyAiAgentDraft({
        id: '', name: draft.name, role: draft.role, description: draft.description, emoji: draft.emoji,
        status: 'idle', statusLabel: isZh ? '空闲' : 'Idle', responsibilities: [], skills: [],
        teamIds: [], currentWorkId: null, settings: draft.settings, enabled: draft.enabled,
    }, draft);
    const created = await createAiAgent(credentials(), agentInput(template));
    const next = await refreshManagedAiTeamData();
    const agent = next.agents.find((item) => item.id === created.id);
    if (!agent) throw new Error('Created agent was not returned by the server');
    return agent;
}

export async function duplicateManagedAiAgent(agent: AiAgent, _isZh: boolean): Promise<AiAgent> {
    const created = await duplicateAiAgent(credentials(), agent.id);
    const next = await refreshManagedAiTeamData();
    const copy = next.agents.find((item) => item.id === created.id);
    if (!copy) throw new Error('Duplicated agent was not returned by the server');
    return copy;
}

export async function deleteManagedAiAgent(id: string): Promise<void> {
    await deleteAiAgent(credentials(), id);
    await refreshManagedAiTeamData();
}

export async function saveManagedAiTeam(team: AiTeam): Promise<void> {
    await updateAiTeam(credentials(), team.id, teamInput(team));
    await refreshManagedAiTeamData();
}

export async function createManagedAiTeam(input: Omit<AiTeam, 'id' | 'progress'> & { progress?: number }): Promise<AiTeam> {
    const created = await createAiTeam(credentials(), teamInput({ ...input, id: '', progress: input.progress ?? 0 }));
    const next = await refreshManagedAiTeamData();
    const team = next.teams.find((item) => item.id === created.id);
    if (!team) throw new Error('Created team was not returned by the server');
    return team;
}

export async function deleteManagedAiTeam(id: string): Promise<void> {
    await deleteAiTeam(credentials(), id);
    await refreshManagedAiTeamData();
}

export async function ensureManagedAgentConversation(agent: AiAgent, _isZh: boolean): Promise<AiConversation> {
    const result = await ensureAiConversation(credentials(), { agentId: agent.id });
    const next = await refreshManagedAiTeamData();
    const conversation = next.conversations.find((item) => item.id === result.id);
    if (!conversation) throw new Error('Conversation was not returned by the server');
    return conversation;
}

export async function ensureManagedTeamConversation(team: AiTeam, _isZh: boolean): Promise<AiConversation> {
    const result = await ensureAiConversation(credentials(), { agentId: team.leaderId, teamId: team.id });
    const next = await refreshManagedAiTeamData();
    const conversation = next.conversations.find((item) => item.id === result.id);
    if (!conversation) throw new Error('Conversation was not returned by the server');
    return conversation;
}

export async function createManagedAiAssignment(input: { agent: AiAgent; teamId: string; title: string; summary: string; isZh: boolean }) {
    const result = await createAiAssignment(credentials(), {
        agentId: input.agent.id,
        teamId: input.teamId || undefined,
        title: input.title,
        summary: input.summary,
        sourceType: 'execution',
        sourceLabel: input.isZh ? '直接分配' : 'Direct assignment',
    });
    const next = await refreshManagedAiTeamData();
    const work = next.workItems.find((item) => item.id === result.workItemId);
    const execution = next.executions.find((item) => item.id === result.executionId);
    const conversation = next.conversations.find((item) => item.id === result.conversationId);
    if (!work || !execution || !conversation) throw new Error('Assignment state is incomplete');
    return { work, execution, conversation };
}

export async function sendManagedAiMessage(conversationId: string, text: string): Promise<void> {
    await sendAiConversationMessage(credentials(), conversationId, text);
    await refreshManagedAiTeamData();
}

export async function setManagedAiWorkAcceptance(workItemId: string, status: 'approved' | 'changes_requested', note?: string): Promise<void> {
    await updateAiWorkAcceptance(credentials(), workItemId, status, note);
    await refreshManagedAiTeamData();
}
