import { describe, expect, it } from 'vitest';
import { AiAgentSettingsSchema, AiTeamDataSchema } from './aiTeams';

const settings = {
    instructions: 'Implement and verify the requested change.',
    engine: 'codex' as const,
    model: 'default',
    workingDirectory: '/workspace/project',
    permissionMode: 'approval' as const,
    allowDelegation: true,
};

describe('AI team wire schemas', () => {
    it('accepts settings that map to the real execution contract', () => {
        expect(AiAgentSettingsSchema.parse(settings)).toEqual(settings);
    });

    it('rejects invalid execution permissions', () => {
        expect(() => AiAgentSettingsSchema.parse({ ...settings, permissionMode: 'mock-auto' })).toThrow();
    });

    it('validates a complete empty state payload', () => {
        expect(AiTeamDataSchema.parse({
            agents: [{
                id: 'agent-1', name: 'Builder', role: 'Engineer', description: 'Builds features',
                status: 'idle', statusLabel: 'Idle', emoji: '', skills: [], responsibilities: [],
                teamIds: [], currentWorkId: null, settings, enabled: true, availability: 'online',
            }],
            teams: [],
            workItems: [],
            executions: [],
            conversations: [],
            messages: {},
        }).agents[0]?.id).toBe('agent-1');
    });
});
