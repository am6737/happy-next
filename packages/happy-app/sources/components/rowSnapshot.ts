import stripAnsi from 'strip-ansi';
import { Message, ToolCall } from '@/sync/typesMessage';

/**
 * A folded turn's line reports how long it took and how many steps it hid. While the turn is still
 * running, that is not enough to tell what is happening — everything else about the turn is off
 * screen — so the line also carries a snapshot of the newest row it hid: the step in flight, in one
 * sentence.
 *
 * A step is named the way the row it stands for is named: the tool's own title, which is what the
 * reader would have seen on that row. The title comes from the tool registry (tools/knownTools.tsx)
 * and is handed in by the caller rather than looked up here — the registry is a module of React
 * components, and this is called per folded row on every render, so the caller that already has the
 * registry in hand resolves it. A tool the registry has nothing to say about — or nothing beyond the
 * tool's own name — falls back to the call's own words.
 */
const SUBJECT_KEYS = ['file_path', 'notebook_path', 'path', 'pattern', 'query', 'url', 'prompt', 'command'];

/** Long enough to say what a step is, short enough to leave the duration and count readable. */
const SNAPSHOT_MAX_CHARS = 120;

function clip(text: string): string {
    const trimmed = text.trim();
    return trimmed.length > SNAPSHOT_MAX_CHARS ? `${trimmed.slice(0, SNAPSHOT_MAX_CHARS - 1)}…` : trimmed;
}

function firstLine(text: string): string {
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) return trimmed;
    }
    return '';
}

/**
 * A tool's headline as the registry gives it: what to show, and whether that text is only the
 * tool's own name rather than something read out of the call.
 */
export type ToolHeadline = {
    text: string;
    /**
     * True when the registry had nothing to go on but the tool's name — "Terminal" for a command
     * nobody described, "View Image". That names the tool and no more, so it is not a headline: the
     * call's own words say more about which step this was, and the name is kept back for a call that
     * has nothing else to say.
     */
    generic: boolean;
};

/** The value the call is working on, when its input names one. */
function inputSubject(tool: ToolCall): string | null {
    const input = tool.input;
    if (input !== null && typeof input === 'object') {
        for (const key of SUBJECT_KEYS) {
            const value = (input as Record<string, unknown>)[key];
            // A command is usually several lines; the first says what it is.
            if (typeof value === 'string' && value.trim()) return firstLine(value);
        }
    }
    return null;
}

/**
 * What a folded line shows for a tool call. `headline` is the registry's title for it, or null when
 * the registry has none.
 *
 * A title the registry read out of the call — a path, a pattern, a query, the agent's own note on a
 * command — already says what the step was, and is the line on its own. A title that is only the
 * registry's word for the tool is a name rather than a headline, and a name is worth less here than
 * what the call is working on: the step reads as `yarn deploy --env staging`, not as `Terminal yarn
 * deploy --env staging`. That name is kept back for a call with nothing else to say, where it still
 * reads better than the raw tool name.
 */
export function toolSnapshot(tool: ToolCall, headline: ToolHeadline | null): string {
    if (headline && !headline.generic) return clip(firstLine(headline.text));

    // Nothing that names the step. The agent's own note on the call, then what the call is working
    // on, then a name for it — the registry's if it has one.
    if (tool.description) return clip(firstLine(tool.description));
    const subject = inputSubject(tool);
    if (subject) return clip(headline ? subject : `${tool.name} ${subject}`);
    return clip(headline ? headline.text : tool.name);
}

/** What a folded line shows in place of this row, or null when the row has nothing to say. */
export function rowSnapshot(message: Message, headline: ToolHeadline | null = null): string | null {
    switch (message.kind) {
        case 'tool-call':
            return toolSnapshot(message.tool, headline);
        case 'agent-text':
            return clip(firstLine(message.text)) || null;
        case 'agent-event':
            return message.event.type === 'message' ? clip(stripAnsi(message.event.message)) || null : null;
        default:
            return null;
    }
}

/**
 * What a folded line shows at its far end: the newest row it hides that has something to say.
 *
 * Rows with nothing to say — a mode switch, a notice — are stepped over rather than blanking the line,
 * because what the reader wants is the nearest step, not strictly the last row.
 *
 * `lineRow` is the row the folded line is drawn on, tried last of all: it is the turn's first row, so
 * anything hidden below it says more about what the turn is up to — but when it is the only thing the
 * fold has taken, naming it beats leaving the line blank. It is null when the fold left that row's own
 * content standing, which it does for a landmark and for a settled turn's answer: the row is on screen
 * as itself, so the line has nothing to say about it.
 */
export function newestRowSnapshot(params: {
    /** Ids of the rows the fold hides, oldest first. */
    hiddenIds: readonly string[];
    /** The row the line is drawn on, or null when the fold left its content standing. */
    lineRow: Message | null;
    /** The rows those ids name; an id with no row here is stepped over. */
    messageById: ReadonlyMap<string, Message>;
    /**
     * The registry's headline for a tool call, resolved by the caller — same reason as in rowSnapshot:
     * the registry is a module of React components and this runs per folded row on every render.
     */
    headlineOf: (tool: ToolCall) => ToolHeadline | null;
}): string | undefined {
    const { hiddenIds, lineRow, messageById, headlineOf } = params;
    const snapshotOf = (row: Message): string | null =>
        rowSnapshot(row, row.kind === 'tool-call' ? headlineOf(row.tool) : null);

    // Collected oldest first, so the newest is at the end.
    for (let i = hiddenIds.length - 1; i >= 0; i--) {
        const row = messageById.get(hiddenIds[i]);
        if (!row) continue;
        const snapshot = snapshotOf(row);
        if (snapshot) return snapshot;
    }
    return (lineRow ? snapshotOf(lineRow) : null) ?? undefined;
}
