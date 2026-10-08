import { describe, expect, it } from 'vitest';
import { applyAiAgentDraft, applyGeneratedAiAgentDraft, cloneAiAgentDraft, createEmptyAiAgentDraft } from './agentDefinition';
import type { AiAgent } from './types';

describe('AI agent definitions', () => {
    it('does not grant model-suggested runtime access or overwrite current permission choices', () => {
        const current = createEmptyAiAgentDraft();
        current.enabled = false;
        current.settings = { ...current.settings, engine: 'codex', model: 'chosen-model', workingDirectory: '/chosen/repo', permissionMode: 'read_only', allowDelegation: false };
        const generated = createEmptyAiAgentDraft();
        generated.name = 'Reviewer';
        generated.settings = { ...generated.settings, workingDirectory: '/private/repo', permissionMode: 'guarded_auto', allowDelegation: true, instructions: 'Review changes' };
        const result = applyGeneratedAiAgentDraft(current, generated);
        expect(result.name).toBe('Reviewer');
        expect(result.enabled).toBe(false);
        expect(result.settings).toEqual({ ...current.settings, instructions: 'Review changes' });
        expect(current.settings.instructions).toBe('');
    });
    it('creates a safe default draft', () => {
        const draft = createEmptyAiAgentDraft();
        expect(draft.enabled).toBe(true);
        expect(draft.settings.permissionMode).toBe('approval');
        expect(draft.settings.engine).toBe('claude-code');
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
        cloned.settings.instructions = 'Updated';

        expect(agent.skills).toEqual(['TypeScript']);
        expect(agent.settings.instructions).toBe('');
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
