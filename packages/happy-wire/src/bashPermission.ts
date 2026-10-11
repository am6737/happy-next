// "Don't ask again" rules for shell commands. The app writes them and the CLI checks them, so both
// split a command line the same way. A rule is Claude Code's `Bash(<prefix>:*)` (any command that
// starts with the prefix) or `Bash(<command>)` (that exact command). A chained line
// (`cd x && git status`) is split at its operators and every command in it must be covered, so a
// rule for `cd` never lets an `rm` ride along.

/** Tools that run a shell line: Claude's `Bash` and the ACP terminal tool `execute` (Gemini, Qoder) */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'execute']);

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

// Programs whose first argument names what they do, so `git status` can be allowed without `git push`
const SUBCOMMAND_PROGRAMS = new Set(['git', 'npm', 'yarn', 'pnpm', 'bun', 'uv', 'pip', 'brew', 'docker', 'kubectl', 'cargo', 'go', 'gh']);
const SUBCOMMAND = /^[a-z][\w:-]*$/;
const BASH_RULE = /^Bash\((.+)\)$/;

/**
 * The prefix sets a "don't ask again" can cover a shell line with, broadest first: the programs it
 * runs, then — when narrower — each program with its subcommand (`git status`, `npm run`). Empty
 * when the line can only be allowed verbatim (command substitution, a quoted program name).
 */
export function bashAllowPrefixes(command: string): string[][] {
    const commands = splitBashCommand(command);
    if (!commands?.length || commands.some((part) => part.startsWith("''"))) return [];
    const programs = [...new Set(commands.map((part) => part.split(' ')[0]))];
    const subcommands = [...new Set(commands.map((part) => {
        const [program, subcommand = ''] = part.split(' ');
        return SUBCOMMAND_PROGRAMS.has(program) && SUBCOMMAND.test(subcommand) ? `${program} ${subcommand}` : program;
    }))];
    return subcommands.join('\n') === programs.join('\n') ? [programs] : [programs, subcommands];
}

/** The command line a shell tool call runs: its `command` (a string or argv), or the head of Gemini's title. */
export function shellCommandOf(input: unknown): string | null {
    const { command, toolCall } = (input ?? {}) as { command?: unknown; toolCall?: { title?: unknown } };
    const line = Array.isArray(command)
        ? command.filter((part) => typeof part === 'string').join(' ')
        : typeof command === 'string' ? command : typeof toolCall?.title === 'string' ? toolCall.title.split(' [')[0] : '';
    return line.trim() || null;
}

/** Adds `Bash(<prefix>:*)` and `Bash(<command>)` rules to the sets isBashCommandAllowed checks; other rules are skipped. */
export function addBashRules(rules: readonly string[], literals: Set<string>, prefixes: Set<string>): void {
    for (const rule of rules) {
        const body = rule.match(BASH_RULE)?.[1];
        if (body?.endsWith(':*')) prefixes.add(body.slice(0, -2));
        else if (body) literals.add(body);
    }
}

/** Whether every command in the line is an allowed exact command or starts with an allowed prefix. */
export function isBashCommandAllowed(command: string, literals: ReadonlySet<string>, prefixes: ReadonlySet<string>): boolean {
    if (literals.has(command)) return true;
    const commands = splitBashCommand(command);
    if (!commands?.length) return false;
    return commands.every((part) => literals.has(part)
        || [...prefixes].some((prefix) => part === prefix || part.startsWith(`${prefix} `)));
}
