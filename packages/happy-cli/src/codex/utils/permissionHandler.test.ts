import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

import { CodexPermissionHandler } from './permissionHandler';

describe('CodexPermissionHandler', () => {
    let agentState: any;
    let permissionRpcHandler: ((response: any) => Promise<void>) | undefined;
    let session: any;
    let pushClient: any;

    beforeEach(() => {
        agentState = {};
        permissionRpcHandler = undefined;
        session = {
            sessionId: 'session-1',
            rpcHandlerManager: {
                registerHandler: vi.fn((_name: string, handler: (response: any) => Promise<void>) => {
                    permissionRpcHandler = handler;
                }),
            },
            updateAgentState: vi.fn((updater: (state: any) => any) => {
                agentState = updater(agentState);
            }),
        };
        pushClient = { sendToAllDevices: vi.fn() };
    });

    it('forwards structured answers from the app', async () => {
        const handler = new CodexPermissionHandler(session, pushClient);
        const pending = handler.handleToolCall('question-1', 'AskUserQuestion', { questions: [] });

        await permissionRpcHandler!({
            id: 'question-1',
            approved: true,
            answers: { environment: 'Staging' },
        });

        await expect(pending).resolves.toEqual({
            decision: 'approved',
            answers: { environment: 'Staging' },
        });
    });

    it('never auto-approves user questions in full-auto mode', () => {
        const handler = new CodexPermissionHandler(session, pushClient);
        handler.setPermissionMode('full-auto');

        void handler.handleToolCall('question-2', 'AskUserQuestion', { questions: [] });

        expect(agentState.requests?.['question-2']).toMatchObject({ tool: 'AskUserQuestion' });
    });
});
