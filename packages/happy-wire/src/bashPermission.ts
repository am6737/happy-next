// "Don't ask again" rules for shell commands. The app writes them and the CLI checks them, so both
// split a command line the same way. A rule is Claude Code's `Bash(<prefix>:*)` (any command that
// starts with the prefix) or `Bash(<command>)` (that exact command). A chained line
// (`cd x && git status`) is split at its operators and every command in it must be covered, so a
// rule for `cd` never lets an `rm` ride along.

// Quoted text is one argument, so operators inside it don't split the line
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
// Redirections that contain `&` without chaining anything: 2>&1, >&2, &>file, &>>file
const AMPERSAND_REDIRECTION = /\d*>&\d*-?|&>>?/g;
const COMMAND_SEPARATOR = /&&|\|\||[;|&\n]/;
// Command substitution runs another command anywhere in the line, even inside double quotes
const COMMAND_SUBSTITUTION = /`|\$\(/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The commands a shell line runs, each without its leading VAR=value words and with quoted
 * arguments blanked. Null when the line uses command substitution, which can't be split safely.
 */
export function splitBashCommand(command: string): string[] | null {
    if (COMMAND_SUBSTITUTION.test(command)) return null;
    const commands: string[] = [];
    for (const part of command.replace(QUOTED, "''").replace(AMPERSAND_REDIRECTION, ' ').split(COMMAND_SEPARATOR)) {
        const words = part.trim().split(/\s+/).filter(Boolean);
        const start = words.findIndex((word) => !ENV_ASSIGNMENT.test(word));
        if (start >= 0) commands.push(words.slice(start).join(' '));
    }
    return commands;
}

/**
 * Rules that stop asking for a command: one prefix rule per program the line runs. A line that
 * can't be split, or whose program name is quoted, is only allowed verbatim.
 */
export function bashAllowRules(command: string): string[] {
    const commands = splitBashCommand(command);
    if (!commands?.length || commands.some((part) => part.startsWith("''"))) return [`Bash(${command})`];
    return [...new Set(commands.map((part) => part.split(' ')[0]))].map((program) => `Bash(${program}:*)`);
}

/** Whether every command in the line is an allowed exact command or starts with an allowed prefix. */
export function isBashCommandAllowed(command: string, literals: ReadonlySet<string>, prefixes: ReadonlySet<string>): boolean {
    if (literals.has(command)) return true;
    const commands = splitBashCommand(command);
    if (!commands?.length) return false;
    return commands.every((part) => literals.has(part)
        || [...prefixes].some((prefix) => part === prefix || part.startsWith(`${prefix} `)));
}
