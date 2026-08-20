import * as React from 'react';
import { createId } from '@paralleldrive/cuid2';
import { MMKV } from 'react-native-mmkv';
import { applyAiAgentDraft, type AiAgentDraft } from './agentDefinition';
import {
    getAiTeamMockData,
    type AiAgent,
    type AiChatMessage,
    type AiConversation,
    type AiExecution,
    type AiMockExecutionSession,
    type AiTeam,
    type AiTeamMockData,
    type AiWorkItem,
} from './mockData';

const storage = new MMKV({ id: 'ai-agent-management' });
const STORAGE_KEY = 'agents-v1';

type PersistedAgentState = {
    upserts: Record<string, AiAgent>;
    deletedIds: string[];
    teamUpserts: Record<string, AiTeam>;
    deletedTeamIds: string[];
    workUpserts: Record<string, AiWorkItem>;
    executionUpserts: Record<string, AiExecution>;
    executionSessionUpserts: Record<string, AiMockExecutionSession>;
    conversationUpserts: Record<string, AiConversation>;
    deletedConversationIds: string[];
    messageUpserts: Record<string, AiChatMessage[]>;
};

const emptyState: PersistedAgentState = {
    upserts: {},
    deletedIds: [],
    teamUpserts: {},
    deletedTeamIds: [],
    workUpserts: {},
    executionUpserts: {},
    executionSessionUpserts: {},
    conversationUpserts: {},
    deletedConversationIds: [],
    messageUpserts: {},
};

function objectRecord<T>(value: unknown): Record<string, T> {
    return value && typeof value === 'object' ? value as Record<string, T> : {};
}

function loadState(): PersistedAgentState {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) return emptyState;
    try {
        const parsed = JSON.parse(raw) as Partial<PersistedAgentState>;
        return {
            upserts: objectRecord<AiAgent>(parsed.upserts),
            deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds.filter((id): id is string => typeof id === 'string') : [],
            teamUpserts: objectRecord<AiTeam>(parsed.teamUpserts),
            deletedTeamIds: Array.isArray(parsed.deletedTeamIds) ? parsed.deletedTeamIds.filter((id): id is string => typeof id === 'string') : [],
            workUpserts: objectRecord<AiWorkItem>(parsed.workUpserts),
            executionUpserts: objectRecord<AiExecution>(parsed.executionUpserts),
            executionSessionUpserts: objectRecord<AiMockExecutionSession>(parsed.executionSessionUpserts),
            conversationUpserts: objectRecord<AiConversation>(parsed.conversationUpserts),
            deletedConversationIds: Array.isArray(parsed.deletedConversationIds) ? parsed.deletedConversationIds.filter((id): id is string => typeof id === 'string') : [],
            messageUpserts: objectRecord<AiChatMessage[]>(parsed.messageUpserts),
        };
    } catch (error) {
        console.warn('Failed to load locally managed AI agents', error);
        return emptyState;
    }
}

let state = loadState();
let revision = 0;
const listeners = new Set<() => void>();

function commit(next: PersistedAgentState) {
    state = next;
    revision += 1;
    storage.set(STORAGE_KEY, JSON.stringify(next));
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getRevision() {
    return revision;
}

function mergeById<T extends { id: string }>(base: T[], upserts: Record<string, T>, deletedIds: string[] = []): T[] {
    const deleted = new Set(deletedIds);
    const baseIds = new Set(base.map((item) => item.id));
    const merged = base.filter((item) => !deleted.has(item.id)).map((item) => upserts[item.id] ?? item);
    for (const item of Object.values(upserts)) {
        if (!baseIds.has(item.id) && !deleted.has(item.id)) merged.push(item);
    }
    return merged;
}

function mergeData(base: AiTeamMockData): AiTeamMockData {
    const agents = mergeById(base.agents, state.upserts, state.deletedIds);
    const teams = mergeById(base.teams, state.teamUpserts, state.deletedTeamIds);
    const workItems = mergeById(base.workItems, state.workUpserts);
    const executions = mergeById(base.executions, state.executionUpserts);
    const executionSessions = mergeById(base.executionSessions, state.executionSessionUpserts);
    const conversations = mergeById(base.conversations, state.conversationUpserts, state.deletedConversationIds);
    const messages = { ...base.messages, ...state.messageUpserts };

    const agentsWithTeams = agents.map((agent) => ({
        ...agent,
        teamIds: teams.filter((team) => team.memberIds.includes(agent.id)).map((team) => team.id),
    }));

    return { ...base, agents: agentsWithTeams, teams, workItems, executions, executionSessions, conversations, messages };
}

export function getManagedAiTeamData(): AiTeamMockData {
    return mergeData(getAiTeamMockData());
}

export function useManagedAiTeamData(): AiTeamMockData {
    React.useSyncExternalStore(subscribe, getRevision, getRevision);
    return getManagedAiTeamData();
}

export function saveManagedAiAgent(agent: AiAgent) {
    const conversation = getManagedAiTeamData().conversations.find((item) => item.kind === 'direct' && item.agentId === agent.id);
    const conversationUpserts = conversation ? { ...state.conversationUpserts, [conversation.id]: { ...conversation, title: agent.name, subtitle: agent.role, emoji: agent.emoji } } : state.conversationUpserts;
    commit({
        ...state,
        upserts: { ...state.upserts, [agent.id]: { ...agent, managedLocally: true } },
        deletedIds: state.deletedIds.filter((id) => id !== agent.id),
        conversationUpserts,
    });
}

export function createManagedAiAgent(draft: AiAgentDraft, isZh: boolean): AiAgent {
    const id = `agent-${createId()}`;
    const agent = applyAiAgentDraft({
        id,
        name: draft.name,
        role: draft.role,
        description: draft.description,
        emoji: draft.emoji,
        status: 'idle',
        statusLabel: isZh ? '空闲' : 'Idle',
        availability: 'online',
        responsibilities: [],
        skills: [],
        teamIds: [],
        currentWorkId: null,
        settings: draft.settings,
        enabled: draft.enabled,
        managedLocally: true,
    }, draft);
    saveManagedAiAgent(agent);
    return agent;
}

export function duplicateManagedAiAgent(agent: AiAgent, isZh: boolean): AiAgent {
    const copy = {
        ...agent,
        id: `agent-${createId()}`,
        name: isZh ? `${agent.name} 副本` : `${agent.name} Copy`,
        status: 'idle' as const,
        statusLabel: isZh ? '空闲' : 'Idle',
        availability: 'online' as const,
        currentWorkId: null,
        teamIds: [],
        responsibilities: [...agent.responsibilities],
        skills: [...agent.skills],
        settings: {
            ...agent.settings,
            enabledTools: [...agent.settings.enabledTools],
            customArguments: [...(agent.settings.customArguments ?? [])],
            environmentVariables: [...(agent.settings.environmentVariables ?? [])],
            mcpServers: [...(agent.settings.mcpServers ?? [])],
        },
        managedLocally: true,
    };
    saveManagedAiAgent(copy);
    return copy;
}

export function deleteManagedAiAgent(id: string) {
    const { [id]: _removed, ...upserts } = state.upserts;
    const teamUpserts = Object.fromEntries(Object.entries(state.teamUpserts).map(([teamId, team]) => [teamId, {
        ...team,
        memberIds: team.memberIds.filter((memberId) => memberId !== id),
        leaderId: team.leaderId === id ? team.memberIds.find((memberId) => memberId !== id) ?? '' : team.leaderId,
    }]));
    const conversationIds = getManagedAiTeamData().conversations.filter((item) => item.kind === 'direct' && item.agentId === id).map((item) => item.id);
    commit({ ...state, upserts, teamUpserts, deletedIds: Array.from(new Set([...state.deletedIds, id])), deletedConversationIds: Array.from(new Set([...state.deletedConversationIds, ...conversationIds])) });
}

export function saveManagedAiTeam(team: AiTeam) {
    const conversation = getManagedAiTeamData().conversations.find((item) => item.kind === 'group' && item.teamId === team.id);
    const conversationUpserts = conversation ? { ...state.conversationUpserts, [conversation.id]: { ...conversation, title: team.name, emoji: team.emoji, agentId: team.leaderId, participantAgentIds: [...team.memberIds] } } : state.conversationUpserts;
    commit({
        ...state,
        teamUpserts: { ...state.teamUpserts, [team.id]: team },
        deletedTeamIds: state.deletedTeamIds.filter((id) => id !== team.id),
        conversationUpserts,
    });
}

export function createManagedAiTeam(input: Omit<AiTeam, 'id'>): AiTeam {
    const team: AiTeam = { ...input, id: `team-${createId()}` };
    saveManagedAiTeam(team);
    return team;
}

export function deleteManagedAiTeam(id: string) {
    const { [id]: _removed, ...teamUpserts } = state.teamUpserts;
    const conversationIds = getManagedAiTeamData().conversations.filter((item) => item.kind === 'group' && item.teamId === id).map((item) => item.id);
    commit({ ...state, teamUpserts, deletedTeamIds: Array.from(new Set([...state.deletedTeamIds, id])), deletedConversationIds: Array.from(new Set([...state.deletedConversationIds, ...conversationIds])) });
}

export function saveManagedAiWorkItem(work: AiWorkItem) {
    commit({ ...state, workUpserts: { ...state.workUpserts, [work.id]: work } });
}

export function saveManagedAiExecution(execution: AiExecution) {
    commit({ ...state, executionUpserts: { ...state.executionUpserts, [execution.id]: execution } });
}

export function saveManagedAiExecutionSession(session: AiMockExecutionSession) {
    commit({ ...state, executionSessionUpserts: { ...state.executionSessionUpserts, [session.id]: session } });
}

export function saveManagedAiConversation(conversation: AiConversation) {
    commit({ ...state, conversationUpserts: { ...state.conversationUpserts, [conversation.id]: conversation } });
}

export function setManagedAiMessages(conversationId: string, messages: AiChatMessage[]) {
    const data = getManagedAiTeamData();
    const conversation = data.conversations.find((item) => item.id === conversationId);
    const last = messages.at(-1);
    const lastMessage = last?.kind === 'text' ? last.text : last && 'title' in last ? last.title : conversation?.lastMessage ?? '';
    const conversationUpserts = conversation ? {
        ...state.conversationUpserts,
        [conversation.id]: { ...conversation, lastMessage, timeLabel: last?.timeLabel ?? conversation.timeLabel },
    } : state.conversationUpserts;
    commit({ ...state, messageUpserts: { ...state.messageUpserts, [conversationId]: messages }, conversationUpserts });
}

export function appendManagedAiMessages(conversationId: string, messages: AiChatMessage[]) {
    const current = getManagedAiTeamData().messages[conversationId] ?? [];
    setManagedAiMessages(conversationId, [...current, ...messages]);
}

export function ensureManagedAgentConversation(agent: AiAgent, isZh: boolean): AiConversation {
    const data = getManagedAiTeamData();
    const existing = data.conversations.find((item) => item.kind === 'direct' && item.agentId === agent.id);
    if (existing) return existing;
    const id = `conversation-${createId()}`;
    const conversation: AiConversation = {
        id,
        kind: 'direct',
        agentId: agent.id,
        teamId: null,
        title: agent.name,
        subtitle: agent.role,
        lastMessage: isZh ? '可以从这里开始安排工作。' : 'Start assigning work here.',
        timeLabel: isZh ? '刚刚' : 'Now',
        unread: false,
        emoji: agent.emoji,
        participantAgentIds: [agent.id],
        humanParticipantCount: 1,
    };
    saveManagedAiConversation(conversation);
    setManagedAiMessages(id, [{
        id: `welcome-${createId()}`,
        kind: 'text',
        sender: 'agent',
        agentId: agent.id,
        text: isZh ? `我是${agent.name}，负责${agent.role}。你可以直接告诉我目标、约束和期望结果。` : `I am ${agent.name}, responsible for ${agent.role}. Tell me the goal, constraints, and expected result.`,
        timeLabel: isZh ? '刚刚' : 'Now',
    }]);
    return conversation;
}

export function ensureManagedTeamConversation(team: AiTeam, isZh: boolean): AiConversation {
    const data = getManagedAiTeamData();
    const existing = data.conversations.find((item) => item.kind === 'group' && item.teamId === team.id);
    if (existing) return existing;
    const leader = data.agents.find((agent) => agent.id === team.leaderId) ?? data.agents.find((agent) => team.memberIds.includes(agent.id));
    const id = `conversation-${createId()}`;
    const conversation: AiConversation = {
        id,
        kind: 'group',
        agentId: leader?.id ?? team.memberIds[0] ?? '',
        teamId: team.id,
        title: team.name,
        subtitle: isZh ? `${team.memberIds.length} 位 Agent · 你` : `${team.memberIds.length} agents · You`,
        lastMessage: isZh ? '团队群聊已创建。' : 'Team group chat created.',
        timeLabel: isZh ? '刚刚' : 'Now',
        unread: false,
        emoji: team.emoji,
        participantAgentIds: [...team.memberIds],
        humanParticipantCount: 1,
    };
    saveManagedAiConversation(conversation);
    setManagedAiMessages(id, [{
        id: `welcome-${createId()}`,
        kind: 'text',
        sender: 'agent',
        agentId: leader?.id,
        text: isZh ? `“${team.name}”群聊已准备好。你可以在这里提出目标，由负责人协调团队成员。` : `The “${team.name}” group is ready. Share a goal here and the lead will coordinate the team.`,
        timeLabel: isZh ? '刚刚' : 'Now',
    }]);
    return conversation;
}

export function createManagedAiAssignment(input: { agent: AiAgent; teamId: string; title: string; summary: string; isZh: boolean }) {
    const { agent, teamId, title, summary, isZh } = input;
    const workId = `work-${createId()}`;
    const executionId = `execution-${createId()}`;
    const sessionId = `mock-session-${createId()}`;
    const conversation = ensureManagedAgentConversation(agent, isZh);
    const nowLabel = isZh ? '刚刚' : 'Now';
    const provider = agent.settings.engine === 'codex' ? 'Codex' : agent.settings.engine === 'gemini' ? 'Gemini' : 'Claude Code';
    const work: AiWorkItem = {
        id: workId,
        title,
        status: 'working',
        statusLabel: isZh ? '进行中' : 'In progress',
        assigneeId: agent.id,
        teamId,
        sourceType: 'execution',
        sourceLabel: isZh ? '直接分配' : 'Direct assignment',
        summary,
        requiresDecision: false,
        sourceResourceId: executionId,
        executionIds: [executionId],
        acceptanceStatus: 'pending',
    };
    const execution: AiExecution = {
        id: executionId,
        workItemId: workId,
        agentId: agent.id,
        status: 'running',
        statusLabel: isZh ? '执行中' : 'Running',
        triggerLabel: isZh ? '真人直接分配' : 'Assigned by human',
        startedAt: nowLabel,
        durationLabel: isZh ? '进行中' : 'In progress',
        summary: isZh ? 'Agent 已理解目标，正在整理执行步骤。' : 'The agent understood the goal and is preparing the execution steps.',
        attempt: 1,
        conversationId: conversation.id,
        sessionId,
        events: [
            { id: `event-${createId()}`, kind: 'status', actor: 'human', title: isZh ? '已分配工作' : 'Work assigned', body: summary, timeLabel: nowLabel, status: 'dispatched' },
            { id: `event-${createId()}`, kind: 'status', actor: 'system', title: isZh ? '开始执行' : 'Execution started', timeLabel: nowLabel, status: 'running' },
        ],
    };
    const session: AiMockExecutionSession = {
        id: sessionId,
        executionId,
        agentId: agent.id,
        title,
        provider,
        statusLabel: isZh ? '执行中' : 'Running',
        projectLabel: teamId || 'happy-next',
        messages: [
            { id: `session-user-${createId()}`, role: 'user', text: `${title}\n\n${summary}`, timeLabel: nowLabel },
            { id: `session-agent-${createId()}`, role: 'assistant', text: isZh ? '我已收到任务，正在确认目标、约束和交付标准。' : 'I received the task and am confirming the goal, constraints, and delivery criteria.', timeLabel: nowLabel },
            { id: `session-tool-${createId()}`, role: 'tool', title: isZh ? '整理执行计划' : 'Prepare execution plan', text: isZh ? '已读取当前 Agent 配置与团队上下文。' : 'Loaded the current agent configuration and team context.', timeLabel: nowLabel },
        ],
    };
    saveManagedAiWorkItem(work);
    saveManagedAiExecution(execution);
    saveManagedAiExecutionSession(session);
    saveManagedAiAgent({ ...agent, currentWorkId: work.id, status: 'working', statusLabel: isZh ? '工作中' : 'Working' });
    appendManagedAiMessages(conversation.id, [
        { id: `assigned-${createId()}`, kind: 'text', sender: 'user', text: `${title}\n${summary}`, timeLabel: nowLabel },
        { id: `work-${createId()}`, kind: 'work', sender: 'agent', agentId: agent.id, workItemId: work.id, timeLabel: nowLabel },
    ]);
    return { work, execution, session, conversation };
}
