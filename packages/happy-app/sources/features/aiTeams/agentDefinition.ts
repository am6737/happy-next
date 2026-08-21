import type { AiAgent, AiAgentSettings } from './types';

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
    workingDirectory: '',
    permissionMode: 'approval',
    allowDelegation: true,
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
        settings: { ...defaultAiAgentSettings },
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
        settings: { ...draft.settings },
    };
}
