import { describe, expect, it, vi } from 'vitest';
import type { AcpBackendOptions } from '../acp/AcpBackend';

const mocks = vi.hoisted(() => ({ createBackend: vi.fn() }));
vi.mock('../acp/AcpBackend', () => ({
  AcpBackend: class {
    constructor(public options: AcpBackendOptions) { mocks.createBackend(options); }
  },
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock('@/qoder/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/qoder/constants')>()),
  resolveQoderCommand: () => '/opt/qoder/qodercli',
}));
import { QoderTransport, createQoderBackend, qoderMcpToolName } from './qoder';

describe('createQoderBackend', () => {
  it('runs qodercli in ACP mode with SDK variables blanked and the resume session passed on', () => {
    const onReplayedUpdate = vi.fn();
    createQoderBackend({ cwd: '/work', env: { QODER_AGENT_SDK_ENTRYPOINT: 'desktop', KEEP: '1' }, resumeSessionId: 'abc', onReplayedUpdate });

    expect(mocks.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'qoder',
      cwd: '/work',
      command: '/opt/qoder/qodercli',
      args: ['--acp'],
      env: expect.objectContaining({ QODER_AGENT_SDK_ENTRYPOINT: '', KEEP: '1' }),
      resumeSessionId: 'abc',
      onReplayedUpdate,
    }));
  });
});

describe('QoderTransport', () => {
  const transport = new QoderTransport('qoder');

  it('reads an MCP tool name back from the title', () => {
    expect(transport.nameToolCall({ kind: 'other', title: 'change_title (happy)' })).toBe('mcp__happy__change_title');
    expect(transport.nameToolCall({ kind: 'other', title: 'change_title (happy MCP Server)' })).toBe('mcp__happy__change_title');
  });

  it('names plan mode calls from _meta, where their tool call and permission request titles differ', () => {
    const enterPlan = { kind: 'other', _meta: { qoder: { toolName: 'EnterPlanMode' } } };
    expect(transport.nameToolCall({ ...enterPlan, title: 'EnterPlanMode' })).toBe('EnterPlanMode');
    expect(transport.nameToolCall({ ...enterPlan, title: 'Allow entering plan mode?' })).toBe('EnterPlanMode');
    expect(transport.nameToolCall({ kind: 'switch_mode', title: 'Exit plan mode', _meta: { qoder: { toolName: 'ExitPlanMode' } } })).toBe('ExitPlanMode');
  });

  it('falls back to the title, and leaves calls whose kind names them alone', () => {
    expect(transport.nameToolCall({ kind: 'other', title: 'Allow entering plan mode?' })).toBe('Allow entering plan mode?');
    expect(transport.nameToolCall({ kind: 'execute', title: 'git status (repo)', _meta: { qoder: { toolName: 'Bash' } } })).toBeNull();
  });
});

describe('qoderMcpToolName', () => {
  it('reads both title forms qodercli uses', () => {
    expect(qoderMcpToolName('change_title (happy)')).toBe('mcp__happy__change_title');
    expect(qoderMcpToolName('change_title (happy MCP Server)')).toBe('mcp__happy__change_title');
    expect(qoderMcpToolName('Run tests')).toBeNull();
  });
});
