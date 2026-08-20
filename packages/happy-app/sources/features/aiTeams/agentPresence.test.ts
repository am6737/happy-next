import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ getCurrentLanguage: () => 'zh-Hans' }));

import { deriveAiAgentPresence, getAiAgentPresenceLabel } from './agentPresence';
import { getAiTeamMockData, type AiWorkItem } from './mockData';

function work(agentId: string, status: AiWorkItem['status']): AiWorkItem {
    return {
        id: `work-${status}`,
        title: status,
        status,
        statusLabel: status,
        assigneeId: agentId,
        teamId: 'team-1',
        sourceType: 'execution',
        sourceLabel: 'test',
        summary: '',
        requiresDecision: false,
        sourceResourceId: '',
        executionIds: [],
    };
}

describe('AI agent presence', () => {
    const baseAgent = getAiTeamMockData().agents[0];

    it('treats disabled agents as archived', () => {
        expect(deriveAiAgentPresence({ ...baseAgent, enabled: false }, [work(baseAgent.id, 'working')])).toEqual({
            availability: 'archived',
            workload: 'idle',
            runningCount: 0,
            queuedCount: 0,
            capacity: baseAgent.settings.maxConcurrentTasks,
        });
    });

    it('keeps availability and active workload independent', () => {
        expect(deriveAiAgentPresence({ ...baseAgent, availability: 'online' }, [work(baseAgent.id, 'working')])).toEqual({
            availability: 'online',
            workload: 'working',
            runningCount: 1,
            queuedCount: 0,
            capacity: baseAgent.settings.maxConcurrentTasks,
        });
    });

    it('can show queued work while offline', () => {
        const presence = deriveAiAgentPresence({ ...baseAgent, availability: 'offline' }, [work(baseAgent.id, 'todo')]);
        expect(presence).toMatchObject({ availability: 'offline', workload: 'queued', runningCount: 0, queuedCount: 1 });
        expect(getAiAgentPresenceLabel(presence, true)).toBe('离线 · 排队中');
    });

    it('is idle without current work', () => {
        expect(deriveAiAgentPresence(baseAgent, [])).toMatchObject({ availability: 'online', workload: 'idle', runningCount: 0, queuedCount: 0 });
    });

    it('ignores historical completed work', () => {
        expect(deriveAiAgentPresence(baseAgent, [work(baseAgent.id, 'done')]).workload).toBe('idle');
    });
});
