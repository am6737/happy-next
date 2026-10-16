/**
 * Happy's own MCP tools that every agent runs without asking, in every permission mode.
 *
 * - change_title / preview_html: the app's title and a document for the app to render. The
 *   app issues them and renders change_title as an event, not a tool row, so a pending
 *   permission for it has no footer to approve it from and the turn would hang.
 * - orchestrator_get_context / _list / _pend: read the providers, machines and task state.
 *   They start, change and run nothing.
 *
 * The other orchestrator tools stay off this list on purpose: submit, send_message and cancel
 * drive real agent work, exec runs a shell command on any machine and transfer moves files
 * between machines, so they must keep asking.
 *
 * Unprefixed names; Claude and Qoder see them as `mcp__happy__<name>`.
 */
export const HAPPY_TOOLS_APPROVED_WITHOUT_ASKING: readonly string[] = [
    'change_title',
    'preview_html',
    'orchestrator_get_context',
    'orchestrator_list',
    'orchestrator_pend',
];

export const HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED: readonly string[] =
    HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.map(name => `mcp__happy__${name}`);
