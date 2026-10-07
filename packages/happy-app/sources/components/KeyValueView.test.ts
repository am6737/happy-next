import { describe, expect, it } from 'vitest';
import {
    formatPromptPreview,
    isOrchestratorSubmitToolName,
    parseOrchestratorSubmitTasks,
} from './keyValueOrchestratorSubmit';

describe('KeyValueView orchestrator submit helpers', () => {
    it('detects orchestrator_submit tool names in supported formats', () => {
        expect(isOrchestratorSubmitToolName(undefined)).toBe(false);
        expect(isOrchestratorSubmitToolName('')).toBe(false);
        expect(isOrchestratorSubmitToolName('orchestrator_submit')).toBe(true);
        expect(isOrchestratorSubmitToolName('mcp__happy__orchestrator_submit')).toBe(true);
        expect(isOrchestratorSubmitToolName('mcp:happy:orchestrator_submit')).toBe(true);
        expect(isOrchestratorSubmitToolName('orchestrator_submit_extra')).toBe(false);
        expect(isOrchestratorSubmitToolName('mcp__happy__orchestrator_get_context')).toBe(false);
    });

    it('parses submit tasks and filters invalid fields', () => {
        expect(parseOrchestratorSubmitTasks(null)).toEqual([]);
        expect(parseOrchestratorSubmitTasks({})).toEqual([]);
        expect(parseOrchestratorSubmitTasks([])).toEqual([]);

        const inputs = [
            'bad',
            {
                taskKey: 'security',
                title: '安全审查',
                provider: 'claude',
                model: 'claude-sonnet-4-6',
                prompt: '审查 orchestratorRoutes.ts',
                dependsOn: ['setup', 7, null],
                timeoutMs: 120000,
                workingDirectory: '/workspace/review',
                retry: { maxAttempts: 3, backoffMs: 1000 },
                target: { type: 'machine_id', machineId: 'machine-1' },
                metadata: { owner: 'review' },
                futureOption: { enabled: true },
            },
            {
                dependsOn: [123],
                timeoutMs: Number.NaN,
            },
        ];
        const parsed = parseOrchestratorSubmitTasks(inputs);

        expect(parsed).toEqual([
            {
                input: inputs[1],
                taskKey: 'security',
                title: '安全审查',
                provider: 'claude',
                model: 'claude-sonnet-4-6',
                prompt: '审查 orchestratorRoutes.ts',
                dependsOn: ['setup'],
                timeoutMs: 120000,
            },
            {
                input: inputs[2],
                taskKey: undefined,
                title: undefined,
                provider: undefined,
                model: undefined,
                prompt: undefined,
                dependsOn: [],
                timeoutMs: undefined,
            },
        ]);
    });

    it('formats prompt preview with trim and truncation rules', () => {
        expect(formatPromptPreview('  hello  ')).toBe('hello');
        expect(formatPromptPreview('a'.repeat(220))).toBe('a'.repeat(220));
        expect(formatPromptPreview(` ${'b'.repeat(221)} `)).toBe(`${'b'.repeat(220)}…`);
    });
});
