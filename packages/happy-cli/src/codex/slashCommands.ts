export type CodexSlashCommand =
  | { type: 'compact' }
  | { type: 'review'; target: ReviewTarget }
  | { type: 'goal'; action: 'get' }
  | { type: 'goal'; action: 'clear' }
  | { type: 'goal'; action: 'set'; objective: string }
  | { type: 'goal'; action: 'status'; status: GoalStatus };

export type ReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string | null }
  | { type: 'custom'; instructions: string };

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'complete';

export type CodexSlashCommandParseResult =
  | { matched: true; command: CodexSlashCommand }
  | { matched: false }
  | { matched: true; error: string };

function splitCommand(message: string): { command: string; rest: string } | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/(compact|review|goal)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { command: match[1], rest: match[2]?.trim() ?? '' };
}

export function parseCodexSlashCommand(message: string): CodexSlashCommandParseResult {
  const parsed = splitCommand(message);
  if (!parsed) return { matched: false };

  if (parsed.command === 'compact') {
    if (parsed.rest) return { matched: true, error: '/compact does not accept arguments.' };
    return { matched: true, command: { type: 'compact' } };
  }

  if (parsed.command === 'review') {
    if (!parsed.rest) {
      return { matched: true, command: { type: 'review', target: { type: 'uncommittedChanges' } } };
    }

    const [subcommand, ...restParts] = parsed.rest.split(/\s+/);
    const rest = restParts.join(' ').trim();
    switch (subcommand) {
      case 'base':
        if (!rest) return { matched: true, error: 'Usage: /review base <branch>' };
        return { matched: true, command: { type: 'review', target: { type: 'baseBranch', branch: rest } } };
      case 'commit':
        if (!rest) return { matched: true, error: 'Usage: /review commit <sha>' };
        return { matched: true, command: { type: 'review', target: { type: 'commit', sha: rest, title: null } } };
      case 'custom':
        if (!rest) return { matched: true, error: 'Usage: /review custom <instructions>' };
        return { matched: true, command: { type: 'review', target: { type: 'custom', instructions: rest } } };
      default:
        return { matched: true, error: 'Usage: /review, /review base <branch>, /review commit <sha>, or /review custom <instructions>' };
    }
  }

  if (parsed.command === 'goal') {
    if (!parsed.rest) return { matched: true, command: { type: 'goal', action: 'get' } };

    switch (parsed.rest) {
      case 'clear':
        return { matched: true, command: { type: 'goal', action: 'clear' } };
      case 'pause':
        return { matched: true, command: { type: 'goal', action: 'status', status: 'paused' } };
      case 'resume':
        return { matched: true, command: { type: 'goal', action: 'status', status: 'active' } };
      case 'complete':
        return { matched: true, command: { type: 'goal', action: 'status', status: 'complete' } };
      case 'blocked':
        return { matched: true, command: { type: 'goal', action: 'status', status: 'blocked' } };
      default:
        return { matched: true, command: { type: 'goal', action: 'set', objective: parsed.rest } };
    }
  }

  return { matched: false };
}
