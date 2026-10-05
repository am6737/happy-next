import { describe, expect, it } from 'vitest';
import {
    AgentTextMessage,
    buildPreviewHtmlMessage,
    isPreviewHtmlToolCall,
    normalizePreviewHtmlToolName,
    readPreviewHtmlCard,
    toPreviewHtmlMessage,
    ToolCallMessage,
} from './typesMessage';

const CARD_INPUT = { html: '<html><body>Preview</body></html>', title: 'Weekly report' };

function toolCallMessage(tool: Partial<ToolCallMessage['tool']> = {}): ToolCallMessage {
    return {
        kind: 'tool-call',
        id: 'm1',
        localId: null,
        createdAt: 1700000000000,
        seq: 12,
        tool: {
            name: 'mcp__happy__preview_html',
            state: 'completed',
            input: CARD_INPUT,
            createdAt: 1700000000000,
            startedAt: 1700000000000,
            completedAt: 1700000001000,
            description: null,
            ...tool,
        } as ToolCallMessage['tool'],
        children: [],
    };
}

describe('normalizePreviewHtmlToolName', () => {
    it.each([
        'preview_html',
        'happy__preview_html',
        'mcp__happy__preview_html',
        'mcp:happy:preview_html',
    ])('recognises %s', (name) => {
        expect(normalizePreviewHtmlToolName(name)).toBe('preview_html');
    });

    it('leaves a different tool alone', () => {
        expect(normalizePreviewHtmlToolName('preview_html_extra')).toBe('preview_html_extra');
        expect(normalizePreviewHtmlToolName('mcp__happy__change_title')).toBe('change_title');
    });
});

describe('isPreviewHtmlToolCall', () => {
    it('matches the call under any spelling', () => {
        for (const name of ['preview_html', 'mcp__happy__preview_html', 'mcp:happy:preview_html']) {
            expect(isPreviewHtmlToolCall(toolCallMessage({ name }))).toBe(true);
        }
    });

    it('ignores other tool calls and non-tool rows', () => {
        expect(isPreviewHtmlToolCall(toolCallMessage({ name: 'mcp__happy__change_title' }))).toBe(false);
        const text: AgentTextMessage = {
            kind: 'agent-text',
            id: 'a1',
            localId: null,
            createdAt: 0,
            text: 'hello',
        };
        expect(isPreviewHtmlToolCall(text)).toBe(false);
    });
});

describe('readPreviewHtmlCard', () => {
    it('reads the document the card renders and its title', () => {
        expect(readPreviewHtmlCard(CARD_INPUT)).toEqual(CARD_INPUT);
    });

    it('carries a missing title as null', () => {
        expect(readPreviewHtmlCard({ html: '<html></html>' })).toEqual({ html: '<html></html>', title: null });
    });

    it.each([undefined, null, {}, { html: '' }, { html: 42 }, 'nope'])('reads no card out of %s', (input) => {
        expect(readPreviewHtmlCard(input)).toBeNull();
    });
});

describe('buildPreviewHtmlMessage', () => {
    it('keeps the identity fields and the card title', () => {
        expect(buildPreviewHtmlMessage({
            id: 'm1',
            localId: 'l1',
            createdAt: 1700000000000,
            seq: 12,
            input: CARD_INPUT,
            completed: true,
        })).toEqual({
            kind: 'preview-html',
            id: 'm1',
            localId: 'l1',
            createdAt: 1700000000000,
            seq: 12,
            title: 'Weekly report',
        });
    });

    it('drops a call that is still running', () => {
        expect(buildPreviewHtmlMessage({
            id: 'm1', localId: null, createdAt: 0, input: CARD_INPUT, completed: false,
        })).toBeNull();
    });

    it.each([{}, { html: '' }, undefined])('drops a call with no document (%s)', (input) => {
        expect(buildPreviewHtmlMessage({
            id: 'm1', localId: null, createdAt: 0, input, completed: true,
        })).toBeNull();
    });
});

describe('toPreviewHtmlMessage', () => {
    it('reads the card out of a completed tool-call message', () => {
        expect(toPreviewHtmlMessage(toolCallMessage())?.title).toBe('Weekly report');
    });

    it('returns null while the call runs or has failed', () => {
        expect(toPreviewHtmlMessage(toolCallMessage({ state: 'running' }))).toBeNull();
        expect(toPreviewHtmlMessage(toolCallMessage({ state: 'error' }))).toBeNull();
    });
});
