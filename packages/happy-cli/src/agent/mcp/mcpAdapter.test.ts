import { describe, expect, it, vi } from 'vitest';
import { createMcpContext } from './mcpAdapter';
import type { ApiSessionClient } from '@/api/apiSession';

vi.mock('@/claude/utils/startHappyServer', () => ({
    startHappyServer: async () => ({
        url: 'http://127.0.0.1:1',
        toolNames: ['change_title', 'preview_html', 'orchestrator_get_context', 'orchestrator_submit', 'orchestrator_exec', 'orchestrator_transfer', 'orchestrator_pend', 'orchestrator_list', 'orchestrator_cancel', 'orchestrator_send_message'],
        stop: () => {},
    }),
}));

// allowedToolNames() becomes Claude's allowedTools, which Claude runs without ever reaching
// our permission callback - so it must hold only the Happy tools that never ask.
describe('allowedToolNames', () => {
    it('lists only the Happy tools approved without asking, never the orchestrator tools that run or change things', async () => {
        const mcp = await createMcpContext({} as ApiSessionClient);
        expect(mcp.allowedToolNames().sort()).toEqual([
            'mcp__happy__change_title',
            'mcp__happy__orchestrator_get_context',
            'mcp__happy__orchestrator_list',
            'mcp__happy__orchestrator_pend',
            'mcp__happy__preview_html',
        ]);
    });
});
