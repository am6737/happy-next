import { describe, expect, it } from 'vitest';
import {
    buildPlanProposalMessage,
    isExitPlanModeToolCall,
    isExitPlanModeToolName,
    readPlanProposalSummary,
    toPlanProposalMessage,
    ToolCallMessage,
} from './typesMessage';

function toolCallMessage(name: string, input: unknown): ToolCallMessage {
    return {
        kind: 'tool-call',
        id: 'm1',
        localId: null,
        createdAt: 1700000000000,
        seq: 12,
        tool: {
            name,
            state: 'completed',
            input,
            createdAt: 1700000000000,
            startedAt: 1700000000000,
            completedAt: 1700000001000,
            description: null,
        },
        children: [],
    };
}

describe('readPlanProposalSummary', () => {
    it('takes the plan’s first line of prose', () => {
        expect(readPlanProposalSummary({ plan: 'Ship the fold\n\nThen the rail.' })).toBe('Ship the fold');
    });

    it('strips the markdown marker a heading, a quote or a list item opens with', () => {
        expect(readPlanProposalSummary({ plan: '# Ship the fold' })).toBe('Ship the fold');
        expect(readPlanProposalSummary({ plan: '### Ship the fold' })).toBe('Ship the fold');
        expect(readPlanProposalSummary({ plan: '- Ship the fold' })).toBe('Ship the fold');
        expect(readPlanProposalSummary({ plan: '> Ship the fold' })).toBe('Ship the fold');
        expect(readPlanProposalSummary({ plan: '1. Ship the fold' })).toBe('Ship the fold');
        // Emphasis is prose, not a marker: only a marker with the space after it is taken.
        expect(readPlanProposalSummary({ plan: '**Ship the fold**' })).toBe('**Ship the fold**');
    });

    it('walks past blank and marker-only lines to the first that says something', () => {
        expect(readPlanProposalSummary({ plan: '\n\n##\n\nShip the fold' })).toBe('Ship the fold');
    });

    it('returns null when the call carries no plan to point at', () => {
        expect(readPlanProposalSummary({ plan: '' })).toBeNull();
        expect(readPlanProposalSummary({ plan: '   \n  ' })).toBeNull();
        expect(readPlanProposalSummary({ plan: 42 })).toBeNull();
        expect(readPlanProposalSummary({})).toBeNull();
        expect(readPlanProposalSummary(null)).toBeNull();
        expect(readPlanProposalSummary('nope')).toBeNull();
    });
});

describe('buildPlanProposalMessage', () => {
    it('carries the row’s identity plus the plan’s opening line', () => {
        expect(buildPlanProposalMessage({
            id: 'm1',
            localId: 'l1',
            createdAt: 1700000000000,
            seq: 12,
            input: { plan: '# Ship the fold\nDetails.' },
        })).toEqual({
            kind: 'plan-proposal',
            id: 'm1',
            localId: 'l1',
            createdAt: 1700000000000,
            seq: 12,
            summary: 'Ship the fold',
        });
    });

    it('returns null for a proposal without a plan', () => {
        expect(buildPlanProposalMessage({ id: 'm1', localId: null, createdAt: 0, input: {} })).toBeNull();
    });
});

describe('toPlanProposalMessage', () => {
    it('reads the plan off a reduced tool call', () => {
        const message = toPlanProposalMessage(toolCallMessage('ExitPlanMode', { plan: 'Ship the fold' }));
        expect(message?.summary).toBe('Ship the fold');
        expect(message?.id).toBe('m1');
        expect(message?.seq).toBe(12);
    });

    it('returns null for a proposal whose payload has no plan', () => {
        expect(toPlanProposalMessage(toolCallMessage('ExitPlanMode', {}))).toBeNull();
    });
});

describe('isExitPlanModeToolCall', () => {
    it('reads both spellings of the tool, and the raw name behind them', () => {
        expect(isExitPlanModeToolCall(toolCallMessage('ExitPlanMode', {}))).toBe(true);
        expect(isExitPlanModeToolCall(toolCallMessage('exit_plan_mode', {}))).toBe(true);
        expect(isExitPlanModeToolCall(toolCallMessage('enter_plan_mode', {}))).toBe(false);
        expect(isExitPlanModeToolName('ExitPlanMode')).toBe(true);
        expect(isExitPlanModeToolName('exit_plan_mode')).toBe(true);
        // Entering plan mode proposes nothing — there is no card and so no marker.
        expect(isExitPlanModeToolName('enter_plan_mode')).toBe(false);
    });
});
