//
// What the user sent, told apart from the prompts an agent's transcript records on their behalf.
// One rule for every place that lists the user's prompts: the duplicate sheet, a copied session's
// backfill and the message archive, for every agent.
//

// Texts Happy, the agent or its CLI hands the agent as a prompt of its own: a run's terminal
// callback, a background task's report, a local command's output and the caveat before it, the
// output of a shell command run with `!`, and the instructions and environment Codex opens with.
const GENERATED_TAGS = [
    'task-notification',
    'orchestrator-callback',
    'local-command-stdout',
    'local-command-stderr',
    'local-command-caveat',
    'bash-stdout',
    'bash-stderr',
    'environment_context',
    'user_instructions',
    'turn_aborted',
    'INSTRUCTIONS',
];

// Claude Code's own notes (an interruption, the text companion of an image, a skill's expansion,
// the file or selection an IDE has open) and Codex's instruction files. Claude marks most of them
// isMeta in its transcript, but the stream remote mode reads drops the flag, so the text is what
// tells them apart there.
const GENERATED_PREFIXES = [
    '[Request interrupted',
    '[Image: original ',
    '[Image: source: ',
    'Base directory for this skill:',
    '<ide_',
    '# AGENTS.md',
    '# System instructions',
];

const ATTACHED_FILES_PATTERN = /(^|\n\n)<attached-files>\n[\s\S]*<\/attached-files>\s*$/;

/**
 * The text the user typed, from a prompt `appendAttachmentsToPrompt` built: what a copied session's
 * history shows, as the live session did. A prompt that was only files keeps its block, the one
 * trace of what was sent.
 */
export function stripAttachmentsFromPrompt(text: string): string {
    const typed = text.replace(ATTACHED_FILES_PATTERN, '');
    return typed.trim() ? typed : text;
}

function tagContent(text: string, tag: string): string | null {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : null;
}

/**
 * A prompt as the user sent it — a slash command as `/name args`, a `!` command as `! command`,
 * attached files left out — or null when Happy, the agent or its CLI wrote it.
 */
export function userPromptText(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (GENERATED_TAGS.some((tag) => trimmed.startsWith(`<${tag}`) && trimmed.includes(`</${tag}>`))) return null;
    if (GENERATED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return null;

    const command = tagContent(trimmed, 'command-name');
    if (command !== null && (trimmed.startsWith('<command-name>') || trimmed.startsWith('<command-message>'))) {
        const name = command.startsWith('/') ? command : `/${command}`;
        return [name, tagContent(trimmed, 'command-args')].filter(Boolean).join(' ');
    }
    const shell = trimmed.startsWith('<bash-input>') ? tagContent(trimmed, 'bash-input') : null;
    if (shell !== null) return `! ${shell}`;

    return stripAttachmentsFromPrompt(text);
}
