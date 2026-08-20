import { describe, expect, it } from 'vitest';
import { applyAiAgentDraft, cloneAiAgentDraft, createEmptyAiAgentDraft } from './agentDefinition';
import type { AiAgent } from './mockData';

describe('AI agent definitions', () => {
    it('creates a safe default draft', () => {
        const draft = createEmptyAiAgentDraft();
        expect(draft.enabled).toBe(true);
        expect(draft.settings.permissionMode).toBe('approval');
        expect(draft.settings.visibility).toBe('private');
        expect(draft.settings.enabledTools).toEqual(['files', 'terminal', 'git']);
    });

    it('clones nested configuration before editing', () => {
        const draft = createEmptyAiAgentDraft();
        const agent: AiAgent = {
            id: 'agent-1',
            name: 'Builder',
            role: 'Engineer',
            description: 'Builds features',
            status: 'idle',
            statusLabel: 'Idle',
            emoji: '🛠️',
            skills: ['TypeScript'],
            responsibilities: ['Implement'],
            teamIds: [],
            currentWorkId: null,
            settings: draft.settings,
        };

        const cloned = cloneAiAgentDraft(agent);
        cloned.skills.push('Testing');
        cloned.settings.enabledTools.push('github');

        expect(agent.skills).toEqual(['TypeScript']);
        expect(agent.settings.enabledTools).toEqual(['files', 'terminal', 'git']);
    });

    it('applies trimmed draft values without losing identity and history', () => {
        const draft = createEmptyAiAgentDraft();
        const agent: AiAgent = {
            id: 'agent-1',
            name: 'Old',
            role: 'Old role',
            description: 'Old description',
            status: 'working',
            statusLabel: 'Working',
            emoji: '🤖',
            skills: [],
            responsibilities: [],
            teamIds: ['team-1'],
            currentWorkId: 'work-1',
            settings: draft.settings,
        };

        const updated = applyAiAgentDraft(agent, {
            ...draft,
            name: '  Builder  ',
            role: ' Engineer ',
            description: ' Ships features ',
        });

        expect(updated.name).toBe('Builder');
        expect(updated.teamIds).toEqual(['team-1']);
        expect(updated.currentWorkId).toBe('work-1');
        expect(updated.status).toBe('working');
    });
});
