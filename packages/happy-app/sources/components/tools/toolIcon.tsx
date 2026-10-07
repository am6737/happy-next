import * as React from 'react';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from './knownTools';
import { formatMCPIcon } from './views/MCPToolView';

/**
 * The icon a tool call's row wears, at any size: the registry's, an MCP tool's own, or the generic
 * wrench. Resolved the way ToolView resolves it, so anything else that names a call by its icon shows
 * the same one the row does.
 */
export function toolIcon(tool: ToolCall, size: number, color: string): React.ReactElement {
    if (tool.name.startsWith('mcp__') || tool.name.startsWith('mcp:')) {
        return formatMCPIcon(tool, size, color);
    }
    // A Codex command is a read, an edit or a command proper, and says which in its parsed form.
    if (tool.name === 'CodexBash' && Array.isArray(tool.input?.parsed_cmd) && tool.input.parsed_cmd.length > 0) {
        const type = tool.input.parsed_cmd[0]?.type;
        const name = type === 'read' ? 'eye' : type === 'write' ? 'file-diff' : 'terminal';
        return <Octicons name={name} size={size} color={color} />;
    }
    const known = knownTools[tool.name as keyof typeof knownTools] as { icon?: (size: number, color: string) => React.ReactElement } | undefined;
    if (typeof known?.icon === 'function') return known.icon(size, color);
    return <Ionicons name="construct-outline" size={size} color={color} />;
}
