import { ToolCall } from '@/sync/typesMessage';
import { parseMcpResult } from './parseMcpResult';

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeOrchestratorToolName(name: string): string {
    return name
        .replace(/__/g, ':')
        .replace(/^mcp:/, '')
        .replace(/^happy:/, '');
}

function extractRunIdFromResult(result: unknown): string | null {
    const parsed = parseMcpResult(result);
    const obj = parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;

    return (
        asString(obj?.runId)
        ?? asString(obj?.data?.runId)
        ?? asString(obj?.run?.runId)
        ?? asString(obj?.data?.run?.runId)
        ?? asString(obj?.submit?.runId)
        ?? asString(obj?.blocking?.run?.runId)
        ?? null
    );
}

function extractRunTitle(tool: ToolCall): string | null {
    const parsed = parseMcpResult(tool.result);
    const obj = parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;

    return (
        asString(tool.input?.title)
        ?? asString(obj?.title)
        ?? asString(obj?.data?.title)
        ?? asString(obj?.run?.title)
        ?? asString(obj?.data?.run?.title)
        ?? null
    );
}

export type OrchestratorToolNavigationTarget =
    | { type: 'run'; runId: string; title: string | null; }
    | { type: 'list'; };

export function getOrchestratorToolNavigationTarget(tool: ToolCall): OrchestratorToolNavigationTarget | null {
    const toolName = normalizeOrchestratorToolName(tool.name);

    if (toolName === 'orchestrator_list') {
        return { type: 'list' };
    }

    let runId: string | null = null;
    if (toolName === 'orchestrator_submit' || toolName === 'orchestrator_send_message') {
        runId = extractRunIdFromResult(tool.result);
    } else if (toolName === 'orchestrator_pend' || toolName === 'orchestrator_cancel') {
        runId = asString(tool.input?.runId);
    } else {
        return null;
    }

    if (!runId) {
        return null;
    }

    return {
        type: 'run',
        runId,
        title: extractRunTitle(tool),
    };
}

export function extractOrchestratorSubmitRunId(tool: ToolCall): string | null {
    if (normalizeOrchestratorToolName(tool.name) !== 'orchestrator_submit') {
        return null;
    }
    return extractRunIdFromResult(tool.result);
}
