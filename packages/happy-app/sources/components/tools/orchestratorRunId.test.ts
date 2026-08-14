import { describe, expect, it } from 'vitest';
import { extractOrchestratorSubmitRunId, getOrchestratorToolNavigationTarget } from './orchestratorRunId';
import { ToolCall } from '@/sync/typesMessage';

function createTool(overrides: Partial<ToolCall>): ToolCall {
    return {
        name: 'mcp__happy__orchestrator_submit',
        state: 'completed',
        input: {},
        createdAt: 0,
        startedAt: 0,
        completedAt: 0,
        description: null,
        ...overrides,
    };
}

describe('extractOrchestratorSubmitRunId', () => {
    it('returns null for non-orchestrator_submit tools', () => {
        const tool = createTool({ name: 'mcp__happy__orchestrator_pend' });
        expect(extractOrchestratorSubmitRunId(tool)).toBeNull();
    });

    it('extracts runId from plain object result', () => {
        const tool = createTool({ result: { data: { runId: 'run-123' } } });
        expect(extractOrchestratorSubmitRunId(tool)).toBe('run-123');
    });

    it('extracts runId from json text array result', () => {
        const tool = createTool({
            result: [{ type: 'text', text: JSON.stringify({ data: { runId: 'run-456' } }) }],
        });
        expect(extractOrchestratorSubmitRunId(tool)).toBe('run-456');
    });

    it('returns null when runId is missing', () => {
        const tool = createTool({ result: { data: { status: 'running' } } });
        expect(extractOrchestratorSubmitRunId(tool)).toBeNull();
    });
});

describe('getOrchestratorToolNavigationTarget', () => {
    it.each([
        'orchestrator_submit',
        'mcp__happy__orchestrator_submit',
        'mcp:happy:orchestrator_submit',
    ])('routes %s result to its run', (name) => {
        expect(getOrchestratorToolNavigationTarget(createTool({
            name,
            input: { title: 'Run title' },
            result: { data: { runId: 'run-submit' } },
        }))).toEqual({ type: 'run', runId: 'run-submit', title: 'Run title' });
    });

    it.each(['orchestrator_pend', 'orchestrator_cancel'])('routes %s input to its run', (name) => {
        expect(getOrchestratorToolNavigationTarget(createTool({
            name: `mcp__happy__${name}`,
            input: { runId: 'run-input' },
        }))).toEqual({ type: 'run', runId: 'run-input', title: null });
    });

    it('routes send_message result to its run', () => {
        expect(getOrchestratorToolNavigationTarget(createTool({
            name: 'mcp__happy__orchestrator_send_message',
            input: { taskId: 'task-1' },
            result: [{ type: 'text', text: JSON.stringify({ data: { runId: 'run-message' } }) }],
        }))).toEqual({ type: 'run', runId: 'run-message', title: null });
    });

    it('routes list to the orchestrator list', () => {
        expect(getOrchestratorToolNavigationTarget(createTool({
            name: 'mcp:happy:orchestrator_list',
        }))).toEqual({ type: 'list' });
    });

    it('keeps get_context and missing run ids on message detail', () => {
        expect(getOrchestratorToolNavigationTarget(createTool({
            name: 'mcp__happy__orchestrator_get_context',
        }))).toBeNull();
        expect(getOrchestratorToolNavigationTarget(createTool({
            name: 'mcp__happy__orchestrator_submit',
            result: { data: {} },
        }))).toBeNull();
    });
});
