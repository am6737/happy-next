import { ToolCall } from '@/sync/typesMessage';

export type PreviewHtmlInput = {
    html: string;
    title: string | null;
};

function normalizePreviewHtmlToolName(name: string): string {
    return name
        .replace(/__/g, ':')
        .replace(/^mcp:/, '')
        .replace(/^happy:/, '');
}

export function getPreviewHtmlInput(tool: ToolCall): PreviewHtmlInput | null {
    if (
        normalizePreviewHtmlToolName(tool.name) !== 'preview_html'
        || tool.state !== 'completed'
        || typeof tool.input?.html !== 'string'
        || tool.input.html.length === 0
    ) {
        return null;
    }

    return {
        html: tool.input.html,
        title: typeof tool.input?.title === 'string' ? tool.input.title : null,
    };
}
