import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiTeamRequestError, fetchAiCollaboration, fetchAiSteeringStatus, fetchAiWorkspaceWorkItem,
    runAiWorkspaceProject, sendAiConversationMessage, updateAiWorkAcceptance } from './apiAiTeams';

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.example' }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const auth = { token: 'test-token', secret: 'test-secret' };

describe('AI team transport', () => {
    it('uses the member scoped project run and work item routes', async () => {
        const calls: Array<{ url: string; authorization: string; body?: unknown }> = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, authorization: (init.headers as Record<string, string>).Authorization,
                body: init.body ? JSON.parse(String(init.body)) : undefined });
            return { ok: true, status: 200, json: async () => ({ workItemId: 'work-1', runId: 'run-1' }) };
        }));
        await runAiWorkspaceProject(auth, 'space-1', 'project-1', {
            clientRequestId: 'intent-1', agentId: 'agent-1', title: 'Check', summary: 'Read files',
        });
        await fetchAiWorkspaceWorkItem(auth, 'space-1', 'work-1');
        expect(calls).toEqual([
            { url: 'https://happy.example/v1/ai-team/workspaces/space-1/projects/project-1/run',
                authorization: 'Bearer test-token', body: { clientRequestId: 'intent-1', agentId: 'agent-1', title: 'Check', summary: 'Read files' } },
            { url: 'https://happy.example/v1/ai-team/workspaces/space-1/work-items/work-1',
                authorization: 'Bearer test-token' },
        ]);
    });
    it('sends the same explicit mutation identity on a retry', async () => {
        const bodies: unknown[] = [];
        const fetch = vi.fn(async (_url, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return { ok: true, status: 200, json: async () => ({ kind: 'chat', messageId: 'message-1', executionId: 'execution-1', conversationId: 'conversation-1', runId: 'run-1' }) };
        });
        vi.stubGlobal('fetch', fetch);
        await sendAiConversationMessage(auth, 'conversation-1', 'hello', 'intent-1');
        await sendAiConversationMessage(auth, 'conversation-1', 'hello', 'intent-1');
        expect(bodies).toEqual([{ text: 'hello', clientMessageId: 'intent-1' }, { text: 'hello', clientMessageId: 'intent-1' }]);
    });

    it('sends a clarification answer with its original request identity', async () => {
        let body: unknown;
        vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
            body = JSON.parse(String(init.body));
            return { ok: true, status: 200, json: async () => ({ workItemId: 'work-1', executionId: 'execution-1', conversationId: 'conversation-1', runId: 'run-1' }) };
        }));
        await sendAiConversationMessage(auth, 'conversation-1', 'Use this repository', 'answer-1', {
            clarificationId: 'clarification-1', targetWorkItemId: 'work-1', mode: 'continue',
        });
        expect(body).toEqual({
            text: 'Use this repository', clientMessageId: 'answer-1',
            clarificationId: 'clarification-1', targetWorkItemId: 'work-1', mode: 'continue',
        });
    });

    it('aborts a request whose server never responds', async () => {
        vi.useFakeTimers();
        let signal!: AbortSignal;
        vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
            signal = init.signal!;
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })));
        const request = sendAiConversationMessage(auth, 'conversation-1', 'hello', 'intent-1');
        const failure = expect(request).rejects.toThrow('aborted');
        await vi.advanceTimersByTimeAsync(60_000);
        await failure;
        expect(signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('accepts nullable task metadata from the shared collaboration contract', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
            workItemId: 'work-1', teamId: null, aggregateTaskId: 'task-1',
            tasks: [{ id: 'task-1', taskKey: null, title: null, status: 'completed', parentTaskId: null,
                assignedAgentId: null, dependsOnTaskKeys: [], collaborationRole: null,
                branchName: null, commitSha: null, finalResponse: 'Done' }], audits: [],
        }) })));
        const result = await fetchAiCollaboration(auth, 'work-1');
        expect(result.tasks[0].title).toBeNull();
    });

    it('parses delivered steering separately from the queued send response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
            id: 'steering-1', status: 'delivered', attempts: 1, errorCode: null, deliveredAt: '2026-10-07T00:00:00Z',
        }) })));
        expect((await fetchAiSteeringStatus(auth, 'work-1', 'steering-1')).status).toBe('delivered');
    });

    it('sends a stable identity for a revision request', async () => {
        let body: Record<string, unknown> = {};
        vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
            body = JSON.parse(String(init.body));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }));
        await updateAiWorkAcceptance(auth, 'work-1', 'changes_requested', 'Fix the result', 'revision-1');
        expect(body).toMatchObject({ status: 'changes_requested', note: 'Fix the result', clientMessageId: 'revision-1' });
    });

    it('binds approval to the displayed execution and preserves conflict status', async () => {
        const bodies: unknown[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return { ok: false, status: 409, json: async () => ({ error: 'Only the latest completed work can be accepted' }) };
        }));
        await expect(updateAiWorkAcceptance(auth, 'work-1', 'approved', 'Reviewed', undefined, 'shown-execution-1'))
            .rejects.toMatchObject({ status: 409, name: 'AiTeamRequestError' } satisfies Partial<AiTeamRequestError>);
        expect(bodies).toEqual([{ status: 'approved', note: 'Reviewed', reviewedExecutionId: 'shown-execution-1' }]);
    });
});
