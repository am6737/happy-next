import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import { createMcpServer } from './startHappyServer';
import { teammateToolNames } from '@/teammate/toolSchemas';
import { registerMcpTool } from '@/utils/registerMcpTool';
import { callDaemonTeammateChat } from '@/daemon/controlClient';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/utils/registerMcpTool', () => ({ registerMcpTool: vi.fn() }));
vi.mock('@/daemon/controlClient', () => ({ callDaemonTeammateChat: vi.fn() }));

const client = {} as ApiSessionClient;
const options = { enableHappyTools: false, enableOrchestratorTools: false };

describe('teammate MCP tools', () => {
    beforeEach(() => { vi.stubEnv('HAPPY_TEAMMATE_SESSION_ROLE', 'controller'); vi.stubEnv('HAPPY_TEAMMATE_TASK_ID', ''); vi.mocked(registerMcpTool).mockClear(); vi.mocked(callDaemonTeammateChat).mockReset(); });
    afterEach(() => vi.unstubAllEnvs());
    it('does not register chat tools without the thread env var', () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', '');
        createMcpServer(client, options);
        expect(registerMcpTool).not.toHaveBeenCalled();
        expect(teammateToolNames()).toEqual([]);
    });
    it('registers both tools independently of orchestrator tools and forwards arguments to the daemon', async () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread');
        vi.stubEnv('HAPPY_TEAMMATE_CONTROL_TOKEN', 'token');
        const mcp = createMcpServer(client, options);
        const calls = vi.mocked(registerMcpTool).mock.calls;
        expect(calls.map(call => call[1])).toEqual(['chat_send', 'chat_history', 'memory_note', 'task_create', 'memory_commit']);
        expect(teammateToolNames()).toEqual(calls.map(call => call[1]));
        expect(calls[0][2].description).toContain('options, then end your turn');
        expect(calls[0][2].description).toContain('做了什么 / 验证了什么 / 需要你关注');
        vi.mocked(callDaemonTeammateChat).mockResolvedValue({ seq: 12 });
        const result = await calls[0][3]({ text: 'hello', kind: 'text' });
        expect(callDaemonTeammateChat).toHaveBeenCalledWith('chat-send', { text: 'hello', kind: 'text' });
        expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text: expect.stringContaining('12') }] });
        await calls[1][3]({ limit: 10, beforeSeq: 12 });
        expect(callDaemonTeammateChat).toHaveBeenLastCalledWith('chat-history', { limit: 10, beforeSeq: 12 });
        await mcp.close();
    });
    it('does not expose controller tools to workers carrying thread and task IDs', async () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread');
        vi.stubEnv('HAPPY_TEAMMATE_TASK_ID', 'task');
        vi.stubEnv('HAPPY_TEAMMATE_SESSION_ROLE', 'worker');
        await createMcpServer(client, options).close();
        expect(registerMcpTool).not.toHaveBeenCalled();
        expect(teammateToolNames()).toEqual([]);
    });
    it('registers every task tool with schemas and forwards calls', async () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread');
        vi.stubEnv('HAPPY_TEAMMATE_TASK_ID', 'task');
        const mcp = createMcpServer(client, options);
        const calls = vi.mocked(registerMcpTool).mock.calls;
        expect(calls.map(call => call[1]).sort()).toEqual(['chat_send', 'chat_history', 'memory_note', 'task_create', 'memory_commit', 'task_update', 'task_comment', 'work_session_start', 'work_session_send', 'work_session_read', 'work_session_list', 'work_session_stop'].sort());
        expect(teammateToolNames()).toEqual(calls.map(call => call[1]));
        for (const call of calls.slice(2)) {
            expect(call[2].description.length).toBeGreaterThan(40);
            expect(call[2].inputSchema).toBeDefined();
            vi.mocked(callDaemonTeammateChat).mockResolvedValue({ ok: true });
            expect(await call[3]({})).toMatchObject({ isError: false });
            expect(callDaemonTeammateChat).toHaveBeenLastCalledWith(call[1].replace(/_/g, '-'), {});
        }
        await mcp.close();
    });
    it('returns daemon errors as tool errors', async () => {
        vi.stubEnv('HAPPY_TEAMMATE_THREAD_ID', 'thread');
        const mcp = createMcpServer(client, options);
        vi.mocked(callDaemonTeammateChat).mockRejectedValue(new Error('Teammate thread has no channel'));
        expect(await vi.mocked(registerMcpTool).mock.calls[0][3]({ text: 'x', kind: 'text' }))
            .toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('no channel') }] });
        await mcp.close();
    });
});
