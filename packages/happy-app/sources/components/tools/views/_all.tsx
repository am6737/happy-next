import * as React from 'react';
import { EditView } from './EditView';
import { BashView } from './BashView';
import { Message, ToolCall } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { WriteView } from './WriteView';
import { TodoView } from './TodoView';
import { ExitPlanToolView } from './ExitPlanToolView';
import { MultiEditView } from './MultiEditView';
import { TaskView } from './TaskView';
import { BashViewFull } from './BashViewFull';
import { EditViewFull } from './EditViewFull';
import { MultiEditViewFull } from './MultiEditViewFull';
import { CodexBashView } from './CodexBashView';
import { CodexPatchView } from './CodexPatchView';
import { CodexDiffView } from './CodexDiffView';
import { AskUserQuestionView } from './AskUserQuestionView';
import { GeminiEditView } from './GeminiEditView';
import { GeminiExecuteView } from './GeminiExecuteView';
import { PreviewHtmlViewFull } from './PreviewHtmlViewFull';
import { ViewImageViewFull } from './ViewImageViewFull';
import { getToolImagePath } from '@/utils/toolImagePath';

export type ToolViewProps = {
    tool: ToolCall;
    metadata: Metadata | null;
    messages: Message[];
    sessionId?: string;
    /**
     * A full view that cannot show what it was chosen for hands the page back to its ordinary
     * body — a call the CLI never registered has no image to preview, which is an old call rather
     * than a failure. Supplied by ToolFullView.
     */
    onUnavailable?: () => void;
}

// Type for tool view components
export type ToolViewComponent = React.ComponentType<ToolViewProps>;

// Registry of tool-specific view components
export const toolViewRegistry: Record<string, ToolViewComponent> = {
    Edit: EditView,
    Bash: BashView,
    CodexBash: CodexBashView,
    CodexPatch: CodexPatchView,
    CodexDiff: CodexDiffView,
    GeminiDiff: CodexDiffView,
    Write: WriteView,
    TodoWrite: TodoView,
    ExitPlanMode: ExitPlanToolView,
    exit_plan_mode: ExitPlanToolView,
    MultiEdit: MultiEditView,
    Task: TaskView,
    AskUserQuestion: AskUserQuestionView,
    // Gemini tools (lowercase)
    edit: GeminiEditView,
    execute: GeminiExecuteView,
};

export const toolFullViewRegistry: Record<string, ToolViewComponent> = {
    view_image: ViewImageViewFull,
    Bash: BashViewFull,
    Edit: EditViewFull,
    MultiEdit: MultiEditViewFull,
    'mcp__happy__preview_html': PreviewHtmlViewFull,
    'mcp:happy:preview_html': PreviewHtmlViewFull,
};

// Helper function to get the appropriate view component for a tool
export function getToolViewComponent(toolName: string): ToolViewComponent | null {
    return toolViewRegistry[toolName] || null;
}

// Helper function to get the full view for a tool. Any call whose input names a previewable
// image renders that image, the way view_image does — the CLI registers the file for it.
export function getToolFullViewComponent(tool: ToolCall): ToolViewComponent | null {
    if (getToolImagePath(tool.name, tool.input)) return ViewImageViewFull;
    return toolFullViewRegistry[tool.name] || null;
}

// Export individual components
export { EditView } from './EditView';
export { BashView } from './BashView';
export { CodexBashView } from './CodexBashView';
export { CodexPatchView } from './CodexPatchView';
export { CodexDiffView } from './CodexDiffView';
export { BashViewFull } from './BashViewFull';
export { EditViewFull } from './EditViewFull';
export { MultiEditViewFull } from './MultiEditViewFull';
export { ExitPlanToolView } from './ExitPlanToolView';
export { MultiEditView } from './MultiEditView';
export { TaskView } from './TaskView';
export { AskUserQuestionView } from './AskUserQuestionView';
export { GeminiEditView } from './GeminiEditView';
export { GeminiExecuteView } from './GeminiExecuteView';
export { PreviewHtmlViewFull } from './PreviewHtmlViewFull';
