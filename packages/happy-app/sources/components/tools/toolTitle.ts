import { Metadata } from '@/sync/storageTypes';
import { ToolCall } from '@/sync/typesMessage';
import { ToolHeadline } from '@/components/rowSnapshot';
import { knownTools } from './knownTools';
import { formatMCPTitle } from './views/MCPToolView';

type TitleSpec = string | ((opts: { metadata: Metadata | null; tool: ToolCall }) => string);

/** What the registry says for one call, before anything is made of it. */
function registryTitle(tool: ToolCall, metadata: Metadata | null): string | null {
    const known = knownTools[tool.name as keyof typeof knownTools] as { title?: TitleSpec } | undefined;
    if (!known?.title) return null;
    const title = typeof known.title === 'function' ? known.title({ tool, metadata }) : known.title;
    if (typeof title !== 'string') return null;
    return title.trim() || null;
}

/**
 * The headline the tool registry gives a call: the agent's own note about a command, the file a read
 * is opening, the query a search ran. It is the line the tool's row carries in the chat list, so a
 * folded turn naming its newest step this way says exactly what that row would have said.
 *
 * Null means the registry has nothing for this tool — an unknown name, or an entry with no title —
 * which is the caller's cue to fall back to the call's own words. A title that is nothing but the
 * raw tool name is treated the same way: repeating `mcp__foo__bar` back adds nothing. A title that
 * is only the registry's name for the tool comes back marked `generic`, which asks the caller to say
 * what the call is working on after it — see ToolHeadline.
 */
export function toolTitle(tool: ToolCall, metadata: Metadata | null): ToolHeadline | null {
    // MCP tools are named by their own formatter, exactly as their rows are, and it names the call.
    if (tool.name.startsWith('mcp__') || tool.name.startsWith('mcp:')) {
        const text = formatMCPTitle(tool).trim();
        return text ? { text, generic: false } : null;
    }

    const title = registryTitle(tool, metadata);
    if (!title || title === tool.name) return null;

    // Ask the registry the same question about a call with nothing in it. A title that comes back
    // unchanged was not read out of the call — it is the registry's name for the tool, and "Terminal"
    // on its own does not say which step this was. Comparing against the registry's own answer, in
    // whatever language it is in, is what keeps this off a list of known generic strings.
    let bare: string | null;
    try {
        bare = registryTitle({ ...tool, input: {}, result: {}, description: null }, metadata);
    } catch {
        // A title built from a call's shape may not survive an empty one. The title itself is still
        // good, so the worst case is that the call's subject goes unnamed.
        bare = null;
    }
    return { text: title, generic: bare === title };
}
