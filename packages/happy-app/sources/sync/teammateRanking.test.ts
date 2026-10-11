import { describe, expect, it } from 'vitest';
import { TeammateSchema, type Teammate } from 'happy-wire';
import { rankTeammatesForIssue } from './teammateRanking';

function teammate(name: string, fields: Partial<Teammate> = {}): Teammate {
    return TeammateSchema.parse({
        id: name, handle: name.toLowerCase(), name, avatar: null, role: '', skills: [], repos: [], instructions: '',
        machineId: 'machine', controllerProvider: 'claude', controllerModel: null, controllerPermissionMode: 'default', controllerProfileId: null, controllerEnv: null, workerProvider: 'claude', model: null, workerPermissionMode: 'default', workerProfileId: null, workerEnv: null, maxConcurrentRuns: 3,
        monthlyBudgetUsd: null, heartbeatIntervalMin: null, activeHours: null, timezone: null, dreamingHour: null, canSelfAssign: false,
        status: 'active', createdAt: 0, updatedAt: 0, ...fields,
    });
}

describe('rankTeammatesForIssue', () => {
    it('prioritizes repository ownership with case-insensitive full matches', () => {
        const result = rankTeammatesForIssue([
            teammate('Skills', { skills: ['prisma', 'typescript'], repos: ['org/application'] }),
            teammate('Owner', { repos: ['ORG/APP'] }),
        ], { repo: 'org/app', title: 'Prisma TypeScript migration' });
        expect(result.map(item => item.teammate.name)).toEqual(['Owner', 'Skills']);
        expect(result[0].reasons).toEqual(['repo']);
        expect(result[0].score).toBe(100);
    });
    it('matches title, nullable body and labels, and counts duplicate skills once', () => {
        const result = rankTeammatesForIssue([teammate('Atlas', { skills: ['PRISMA', 'prisma', 'fastify', 'react'] })], {
            repo: 'org/app', title: 'Fix Prisma', body: 'Fastify integration', labels: ['React'],
        });
        expect(result[0].reasons).toEqual(['skill:prisma', 'skill:fastify', 'skill:react']);
        expect(result[0].score).toBe(30);
        expect(rankTeammatesForIssue([teammate('Atlas')], { repo: 'org/app', title: '', body: null })[0].score).toBe(0);
    });
    it('respects keyword boundaries and safely escapes punctuation', () => {
        const result = rankTeammatesForIssue([teammate('Atlas', { skills: ['react', 'C++', 'node.js', ''] })], {
            repo: 'org/app', title: 'Reactive reactions with C++ and node.js',
        });
        expect(result[0].reasons).toEqual(['skill:c++', 'skill:node.js']);
    });
    it('adds a weak role match', () => {
        const result = rankTeammatesForIssue([teammate('Atlas', { role: 'Backend engineer' })], { repo: 'org/app', title: 'Backend issue' });
        expect(result[0].score).toBe(3);
        expect(result[0].reasons).toEqual(['role']);
    });
    it('excludes archived teammates and penalizes both paused statuses', () => {
        const result = rankTeammatesForIssue([
            teammate('Archived', { status: 'archived', repos: ['org/app'] }),
            teammate('Paused', { status: 'paused', repos: ['org/app'] }),
            teammate('Budget', { status: 'budget_paused', repos: ['org/app'] }),
            teammate('Active', { repos: ['org/app'] }),
        ], { repo: 'org/app', title: '' });
        expect(result.map(item => item.teammate.name)).toEqual(['Active', 'Budget', 'Paused']);
        expect(result.map(item => item.score)).toEqual([100, 70, 70]);
    });
    it('sorts equal scores by name, preserving input order for equal names without mutating input', () => {
        const input = [teammate('Zed'), teammate('Atlas', { id: 'first' }), teammate('Atlas', { id: 'second' })];
        expect(rankTeammatesForIssue(input, { repo: 'org/app', title: '' }).map(item => item.teammate.id)).toEqual(['first', 'second', 'Zed']);
        expect(input[0].name).toBe('Zed');
        expect(rankTeammatesForIssue([], { repo: 'org/app', title: '' })).toEqual([]);
    });
});
