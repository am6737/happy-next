import { resolve } from 'node:path';
import { findCodexSessionFile, listCodexSessions } from './utils/codexSessionReader';

export type CodexCliInvocation =
  | {
      kind: 'start';
      startedBy?: 'daemon' | 'terminal';
    }
  | {
      kind: 'resume';
      startedBy?: 'daemon' | 'terminal';
      sessionId?: string;
      includeAllDirectories: boolean;
      selectMostRecent: boolean;
      resumeCwd?: 'session' | 'current' | 'ask';
    }
  | {
      kind: 'help';
    };

export class CodexCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexCliUsageError';
  }
}

export class CodexCliSelectionCancelledError extends Error {
  constructor() {
    super('Codex session selection cancelled.');
    this.name = 'CodexCliSelectionCancelledError';
  }
}

export function parseCodexCliInvocation(args: readonly string[]): CodexCliInvocation {
  const remaining: string[] = [];
  let startedBy: 'daemon' | 'terminal' | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--happy-starting-mode') {
      const value = args[++i];
      if (value !== 'local' && value !== 'remote') {
        throw new CodexCliUsageError('--happy-starting-mode must be followed by "local" or "remote".');
      }
      continue;
    }
    if (arg !== '--started-by') {
      remaining.push(arg);
      continue;
    }

    const value = args[++i];
    if (value !== 'daemon' && value !== 'terminal') {
      throw new CodexCliUsageError('--started-by must be followed by "daemon" or "terminal".');
    }
    startedBy = value;
  }

  if (remaining.length === 0) {
    return { kind: 'start', startedBy };
  }

  if (remaining.length === 1 && (remaining[0] === '--help' || remaining[0] === '-h')) {
    return { kind: 'help' };
  }

  const [command, ...commandArgs] = remaining;
  if (command !== 'resume') {
    throw new CodexCliUsageError(`Unsupported Codex command or option: ${command}`);
  }
  if (commandArgs.length === 1 && (commandArgs[0] === '--help' || commandArgs[0] === '-h')) {
    return { kind: 'help' };
  }

  let sessionId: string | undefined;
  let includeAllDirectories = false;
  let hasLast = false;

  let resumeCwd: 'session' | 'current' | 'ask' | undefined;
  for (let i = 0; i < commandArgs.length; i++) {
    const arg = commandArgs[i];
    if (arg === '--resume-cwd') {
      const value = commandArgs[++i];
      if (value !== 'session' && value !== 'current' && value !== 'ask') {
        throw new CodexCliUsageError('--resume-cwd must be followed by session, current, or ask.');
      }
      resumeCwd = value;
    } else if (arg === '--all') {
      includeAllDirectories = true;
    } else if (arg === '--last') {
      hasLast = true;
    } else if (arg.startsWith('-')) {
      throw new CodexCliUsageError(`Unsupported option for happy codex resume: ${arg}`);
    } else if (sessionId) {
      throw new CodexCliUsageError('happy codex resume accepts at most one session ID.');
    } else {
      sessionId = arg;
    }
  }

  if (hasLast && sessionId) {
    throw new CodexCliUsageError('--last cannot be used together with a session ID.');
  }

  return {
    kind: 'resume',
    startedBy,
    sessionId,
    includeAllDirectories,
    selectMostRecent: hasLast,
    ...(resumeCwd ? { resumeCwd } : {}),
  };
}

export type ResumeSession = {
  sessionId: string;
  sessionFile: string;
  originalPath: string | null;
  title?: string | null;
  updatedAt?: number;
};

type ResumeResolverDependencies = {
  findSessionFile: (sessionId: string) => string | null;
  listSessions: () => Promise<ResumeSession[]>;
  isInteractive?: () => boolean;
  selectSession?: (sessions: readonly ResumeSession[]) => Promise<ResumeSession | null>;
};

async function promptForCodexSession(sessions: readonly ResumeSession[]): Promise<ResumeSession | null> {
  const { selectCodexSession } = await import('./sessionPicker');
  return selectCodexSession(sessions);
}

const defaultResumeResolverDependencies: ResumeResolverDependencies = {
  findSessionFile: findCodexSessionFile,
  listSessions: listCodexSessions,
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  selectSession: promptForCodexSession,
};

export async function resolveCodexResumeFile(
  invocation: Extract<CodexCliInvocation, { kind: 'resume' }>,
  workingDirectory: string = process.cwd(),
  dependencies: ResumeResolverDependencies = defaultResumeResolverDependencies,
): Promise<string> {
  if (invocation.sessionId) {
    const sessionFile = dependencies.findSessionFile(invocation.sessionId);
    if (!sessionFile) {
      throw new CodexCliUsageError(`Codex session not found: ${invocation.sessionId}`);
    }
    return sessionFile;
  }

  const normalizedWorkingDirectory = resolve(workingDirectory);
  const sessions = await dependencies.listSessions();
  // Scope the list by session metadata, not the latest turn_context.cwd.
  // Choosing the working directory after selection is handled by resumeDirectory.ts.
  const matchingSessions = sessions
    .filter(candidate => (
      invocation.includeAllDirectories
      || (candidate.originalPath !== null && resolve(candidate.originalPath) === normalizedWorkingDirectory)
    ))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (matchingSessions.length === 0) {
    const scope = invocation.includeAllDirectories
      ? 'in any directory'
      : `for ${normalizedWorkingDirectory}`;
    const hint = invocation.includeAllDirectories ? '' : ' Try `happy codex resume --all`.';
    throw new CodexCliUsageError(`No resumable Codex session found ${scope}.${hint}`);
  }

  if (invocation.selectMostRecent) {
    return matchingSessions[0].sessionFile;
  }

  const isInteractive = dependencies.isInteractive ?? defaultResumeResolverDependencies.isInteractive!;
  if (!isInteractive()) {
    throw new CodexCliUsageError(
      'Cannot open the Codex session picker without an interactive terminal. '
      + 'Use `happy codex resume --last` or `happy codex resume <SESSION_ID>`.',
    );
  }

  const selectSession = dependencies.selectSession ?? defaultResumeResolverDependencies.selectSession!;
  const selectedSession = await selectSession(matchingSessions);
  if (!selectedSession) {
    throw new CodexCliSelectionCancelledError();
  }
  return selectedSession.sessionFile;
}

export const CODEX_CLI_HELP = `happy codex - Start Codex with Happy remote control

Usage:
  happy codex                       Start a new Codex session
  happy codex resume                Select a session from the current directory
  happy codex resume --last         Resume the latest session in the current directory
  happy codex resume <SESSION_ID>   Resume a specific session
  happy codex resume --all          Select a session from any directory

Options:
  --last                            Resume the most recent session without a picker
  --all                             Include sessions outside the current directory
  --resume-cwd <session|current|ask> Choose resume directory; ask overrides saved preference
  --started-by <daemon|terminal>    Set how the Happy session was started
  -h, --help                        Show this help`;
