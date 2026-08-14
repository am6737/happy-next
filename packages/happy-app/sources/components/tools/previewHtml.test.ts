import { describe, expect, it } from 'vitest';
import { ToolCall } from '@/sync/typesMessage';
import { getPreviewHtmlInput } from './previewHtmlInput';

function createTool(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        name: 'mcp__happy__preview_html',
        state: 'completed',
        input: {
            html: '<html><body>Preview</body></html>',
            title: 'Example',
        },
        createdAt: 0,
        startedAt: 0,
        completedAt: 0,
        description: null,
        ...overrides,
    };
}

describe('getPreviewHtmlInput', () => {
    it.each([
        'preview_html',
        'mcp__happy__preview_html',
        'mcp:happy:preview_html',
    ])('extracts completed HTML preview input from %s', (name) => {
        expect(getPreviewHtmlInput(createTool({ name }))).toEqual({
            html: '<html><body>Preview</body></html>',
            title: 'Example',
        });
    });

    it('allows a preview without a title', () => {
        expect(getPreviewHtmlInput(createTool({
            input: { html: '<html></html>' },
        }))).toEqual({
            html: '<html></html>',
            title: null,
        });
    });

    it.each([
        createTool({ state: 'running' }),
        createTool({ state: 'error' }),
        createTool({ input: { html: '' } }),
        createTool({ name: 'mcp__happy__change_title' }),
    ])('keeps unavailable previews on message detail', (tool) => {
        expect(getPreviewHtmlInput(tool)).toBeNull();
    });
});
