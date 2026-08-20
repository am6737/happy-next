import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ getCurrentLanguage: () => 'zh-Hans' }));

import { findAiExecutionsForWork, getAiTeamMockData, getAiWorkSourcePath } from './mockData';
import { getAiMockGithubIssue } from './mockGithubIssues';

describe('AI team mock data', () => {
    it('keeps agent, team, work item, and conversation references consistent', () => {
        const data = getAiTeamMockData();
        const agentIds = new Set(data.agents.map((agent) => agent.id));
        const teamIds = new Set(data.teams.map((team) => team.id));
        const workItemIds = new Set(data.workItems.map((item) => item.id));
        const executionIds = new Set(data.executions.map((execution) => execution.id));

        for (const team of data.teams) {
            expect(agentIds.has(team.leaderId)).toBe(true);
            expect(team.memberIds).toContain(team.leaderId);
            for (const memberId of team.memberIds) {
                expect(agentIds.has(memberId)).toBe(true);
            }
        }

        for (const agent of data.agents) {
            for (const teamId of agent.teamIds) {
                expect(teamIds.has(teamId)).toBe(true);
            }
            if (agent.currentWorkId) {
                expect(workItemIds.has(agent.currentWorkId)).toBe(true);
            }
            expect(agent.settings.instructions.length).toBeGreaterThan(0);
            expect(agent.settings.workingDirectory.length).toBeGreaterThan(0);
            expect(agent.settings.maxConcurrentTasks).toBeGreaterThan(0);
            expect(new Set(agent.settings.enabledTools).size).toBe(agent.settings.enabledTools.length);
        }

        for (const workItem of data.workItems) {
            expect(agentIds.has(workItem.assigneeId)).toBe(true);
            if (workItem.status === 'done') {
                expect(workItem.acceptanceStatus).toBe('approved');
                expect(workItem.requiresDecision).toBe(false);
            }
            if (workItem.acceptanceStatus === 'approved') {
                expect(workItem.status).toBe('done');
            }
            expect(teamIds.has(workItem.teamId)).toBe(true);
            expect(workItem.executionIds.length).toBeGreaterThan(0);
            expect(getAiWorkSourcePath(workItem)).not.toBeNull();
            for (const executionId of workItem.executionIds) {
                expect(executionIds.has(executionId)).toBe(true);
            }
        }

        for (const execution of data.executions) {
            expect(workItemIds.has(execution.workItemId)).toBe(true);
            expect(agentIds.has(execution.agentId)).toBe(true);
            expect(execution.events.length).toBeGreaterThan(0);
            if (execution.conversationId) {
                expect(data.conversations.some((conversation) => conversation.id === execution.conversationId)).toBe(true);
            }
            if (execution.sessionId) {
                const session = data.executionSessions.find((candidate) => candidate.id === execution.sessionId);
                expect(session).toBeDefined();
                expect(session?.executionId).toBe(execution.id);
                expect(session?.agentId).toBe(execution.agentId);
            }
            for (const event of execution.events) {
                if (event.agentId) {
                    expect(agentIds.has(event.agentId)).toBe(true);
                }
            }
        }

        for (const session of data.executionSessions) {
            const execution = data.executions.find((candidate) => candidate.id === session.executionId);
            const messageIds = session.messages.map((message) => message.id);
            expect(new Set(messageIds).size).toBe(messageIds.length);
            expect(execution).toBeDefined();
            expect(execution?.sessionId).toBe(session.id);
            expect(agentIds.has(session.agentId)).toBe(true);
            expect(session.messages.length).toBeGreaterThan(0);
        }

        for (const conversation of data.conversations) {
            expect(agentIds.has(conversation.agentId)).toBe(true);
            if (conversation.teamId) {
                expect(teamIds.has(conversation.teamId)).toBe(true);
            }
            expect(conversation.humanParticipantCount).toBeGreaterThan(0);
            expect(conversation.participantAgentIds.length).toBeGreaterThan(0);
            for (const participantAgentId of conversation.participantAgentIds) {
                expect(agentIds.has(participantAgentId)).toBe(true);
            }
            if (conversation.kind === 'direct') {
                expect(conversation.participantAgentIds).toEqual([conversation.agentId]);
            }

            const messages = data.messages[conversation.id];
            expect(messages).toBeDefined();
            expect(messages.length).toBeGreaterThanOrEqual(6);
            const messageIds = messages.map((message) => message.id);
            expect(new Set(messageIds).size).toBe(messageIds.length);
            const groupAgentSenders = new Set<string>();
            for (const message of messages) {
                if (message.kind === 'work') {
                    expect(workItemIds.has(message.workItemId)).toBe(true);
                }
                if (message.kind === 'assignment') {
                    expect(message.workItemIds.length).toBeGreaterThan(0);
                    for (const workItemId of message.workItemIds) expect(workItemIds.has(workItemId)).toBe(true);
                }
                if (message.kind === 'decision' && message.selectedOption) {
                    expect(message.options).toContain(message.selectedOption);
                }
                if (message.sender === 'agent' && message.agentId) {
                    expect(agentIds.has(message.agentId)).toBe(true);
                    expect(conversation.participantAgentIds).toContain(message.agentId);
                    groupAgentSenders.add(message.agentId);
                }
                if (conversation.kind === 'group' && message.sender === 'agent') {
                    expect(message.agentId).toBeDefined();
                }
            }
            if (conversation.kind === 'group') {
                expect(conversation.participantAgentIds.length).toBeGreaterThan(1);
                expect(groupAgentSenders.size).toBeGreaterThan(1);
            }
        }
    });

    it('uses fixed historical dates and presents the DooPush case as completed work', () => {
        const data = getAiTeamMockData();
        const serialized = JSON.stringify(data);

        expect(serialized).not.toMatch(/今天|昨天|Today|Yesterday/);
        expect(data.teams[0].progress).toBe(100);
        expect(data.agents.every((agent) => agent.currentWorkId === null)).toBe(true);
        expect(data.agents.every((agent) => agent.status === 'idle')).toBe(true);
        expect(data.workItems.every((workItem) => workItem.status === 'done')).toBe(true);
        expect(data.workItems.every((workItem) => workItem.acceptanceStatus === 'approved')).toBe(true);
        expect(data.executions.filter((execution) => execution.status === 'failed')).toHaveLength(1);
        expect(serialized).toContain('1028e2d9');
        expect(serialized).toContain('d18127bd');
        expect(serialized).toContain('48ace234');
    });

    it('routes mock GitHub work items to the existing issue screen with mock data', () => {
        const data = getAiTeamMockData();
        const githubWorkItems = data.workItems.filter((item) => item.sourceType === 'github');

        expect(githubWorkItems.length).toBeGreaterThan(0);
        for (const workItem of githubWorkItems) {
            const path = getAiWorkSourcePath(workItem);
            expect(path).toContain(`/issue/`);
            expect(path).toContain(`mockWorkId=${workItem.id}`);

            const mockIssue = getAiMockGithubIssue(workItem.id);
            expect(mockIssue).not.toBeNull();
            expect(mockIssue?.issue.number).toBe(Number(workItem.sourceResourceId.split('#')[1]));
            expect(mockIssue?.comments.length).toBeGreaterThan(0);
            expect(mockIssue?.timeline.length).toBeGreaterThan(0);

            const commentIds = new Set(mockIssue?.comments.map((comment) => comment.id));
            const timelineExecutionIds = new Set<string>();
            for (const entry of mockIssue?.timeline ?? []) {
                if (entry.type === 'comment') {
                    expect(commentIds.has(entry.commentId)).toBe(true);
                } else if (entry.executionId) {
                    timelineExecutionIds.add(entry.executionId);
                    expect(data.executions.some((execution) => execution.id === entry.executionId)).toBe(true);
                }
            }
            for (const executionId of workItem.executionIds) {
                expect(timelineExecutionIds.has(executionId)).toBe(true);
            }

            const executions = findAiExecutionsForWork(data, workItem.id);
            expect(executions.map((execution) => execution.attempt)).toEqual(
                [...executions].map((execution) => execution.attempt).sort((a, b) => b - a),
            );
        }
    });

});
