import type { AiAgent, AiAgentSettings } from './mockData';

export type AiAgentDraft = {
    name: string;
    role: string;
    description: string;
    emoji: string;
    responsibilities: string[];
    skills: string[];
    enabled: boolean;
    settings: AiAgentSettings;
};

export const defaultAiAgentSettings: AiAgentSettings = {
    instructions: '',
    engine: 'claude-code',
    model: 'default',
    reasoningLevel: 'medium',
    runtime: 'local',
    workingDirectory: '',
    maxConcurrentTasks: 1,
    permissionMode: 'approval',
    workspaceAccess: 'read_write',
    allowNetwork: true,
    requireApprovalForExternalActions: true,
    allowDelegation: true,
    allowGroupChat: true,
    enabledTools: ['files', 'terminal', 'git'],
    visibility: 'private',
    serviceTier: 'default',
    customArguments: [],
    environmentVariables: [],
    mcpServers: [],
};

export function createEmptyAiAgentDraft(): AiAgentDraft {
    return {
        name: '',
        role: '',
        description: '',
        emoji: '🤖',
        responsibilities: [],
        skills: [],
        enabled: true,
        settings: {
            ...defaultAiAgentSettings,
            enabledTools: [...defaultAiAgentSettings.enabledTools],
            customArguments: [],
            environmentVariables: [],
            mcpServers: [],
        },
    };
}

export function cloneAiAgentDraft(agent: AiAgent): AiAgentDraft {
    return {
        name: agent.name,
        role: agent.role,
        description: agent.description,
        emoji: agent.emoji,
        responsibilities: [...agent.responsibilities],
        skills: [...agent.skills],
        enabled: agent.enabled !== false,
        settings: {
            ...defaultAiAgentSettings,
            ...agent.settings,
            enabledTools: [...agent.settings.enabledTools],
            customArguments: [...(agent.settings.customArguments ?? [])],
            environmentVariables: [...(agent.settings.environmentVariables ?? [])],
            mcpServers: [...(agent.settings.mcpServers ?? [])],
        },
    };
}

export function applyAiAgentDraft(agent: AiAgent, draft: AiAgentDraft): AiAgent {
    return {
        ...agent,
        name: draft.name.trim(),
        role: draft.role.trim(),
        description: draft.description.trim(),
        emoji: draft.emoji.trim() || '🤖',
        responsibilities: [...draft.responsibilities],
        skills: [...draft.skills],
        enabled: draft.enabled,
        settings: {
            ...draft.settings,
            enabledTools: [...draft.settings.enabledTools],
            customArguments: [...(draft.settings.customArguments ?? [])],
            environmentVariables: [...(draft.settings.environmentVariables ?? [])],
            mcpServers: [...(draft.settings.mcpServers ?? [])],
        },
    };
}
