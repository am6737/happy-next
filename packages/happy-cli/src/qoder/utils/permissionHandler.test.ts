import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { QoderPermissionHandler } from './permissionHandler';

describe('QoderPermissionHandler', () => {
  let agentState: any;
  let permissionRpcHandler: ((response: { id: string; approved: boolean; decision?: 'approved' | 'denied' }) => Promise<void>) | undefined;
  let session: any;

  beforeEach(() => {
    agentState = {};
    session = {
      sessionId: 'session-1',
      rpcHandlerManager: {
        registerHandler: vi.fn((name: string, handler: typeof permissionRpcHandler) => {
          if (name === 'permission') permissionRpcHandler = handler;
        }),
      },
      updateAgentState: vi.fn((updater: (state: any) => any) => { agentState = updater(agentState); }),
    };
  });

  it('approves Happy tools without asking', async () => {
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any);
    await expect(handler.handleToolCall('call-1', 'mcp__happy__change_title', { title: 'x' })).resolves.toEqual({ decision: 'approved' });
    expect(session.updateAgentState).not.toHaveBeenCalled();
  });

  it('asks for a same-named tool from another MCP server', () => {
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any);
    void handler.handleToolCall('call-3', 'mcp__other__change_title', { title: 'x' });
    expect(agentState.requests?.['call-3']).toMatchObject({ tool: 'mcp__other__change_title' });
  });

  it('sends every other request to the app and resolves with its answer', async () => {
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any);
    const pending = handler.handleToolCall('call-2', 'Bash', { command: 'rm -rf build' });

    expect(agentState.requests?.['call-2']).toMatchObject({ tool: 'Bash', arguments: { command: 'rm -rf build' } });
    await permissionRpcHandler!({ id: 'call-2', approved: false, decision: 'denied' });
    await expect(pending).resolves.toEqual({ decision: 'denied' });
  });

  it('takes "don\'t ask again" (allowTools) as approved for the session', async () => {
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any);
    const pending = handler.handleToolCall('call-5', 'execute', { command: 'git status' });

    await permissionRpcHandler!({ id: 'call-5', approved: true, allowTools: ['execute'] } as any);
    await expect(pending).resolves.toEqual({ decision: 'approved_for_session' });
    expect(agentState.completedRequests?.['call-5']).toMatchObject({ status: 'approved', decision: 'approved_for_session' });
  });

  it('shows the input it is given for a request, and passes on the mode the app answered with', async () => {
    const withPlan = (toolName: string, input: Record<string, unknown>) => ({ ...input, plan: `# Plan for ${toolName}` });
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any, withPlan);
    const pending = handler.handleToolCall('call-4', 'ExitPlanMode', {});

    expect(agentState.requests?.['call-4']).toMatchObject({ tool: 'ExitPlanMode', arguments: { plan: '# Plan for ExitPlanMode' } });
    await permissionRpcHandler!({ id: 'call-4', approved: true, decision: 'approved', mode: 'acceptEdits' } as any);
    await expect(pending).resolves.toEqual({ decision: 'approved', mode: 'acceptEdits' });
  });
});
