import { normalizePreviewHtmlToolName, PreviewHtmlCard, readPreviewHtmlCard, ToolCall, PREVIEW_HTML_TOOL } from '@/sync/typesMessage';

/** What the inline preview card renders — `title` is null when the call supplied none. */
export type PreviewHtmlInput = PreviewHtmlCard;

export function getPreviewHtmlInput(tool: ToolCall): PreviewHtmlInput | null {
    if (
        normalizePreviewHtmlToolName(tool.name) !== PREVIEW_HTML_TOOL
        || tool.state !== 'completed'
    ) {
        return null;
    }

    return readPreviewHtmlCard(tool.input);
}
