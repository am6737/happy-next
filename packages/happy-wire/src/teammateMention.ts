export type MentionCandidate = { id: string; name: string; handle?: string | null };
export type MentionMatch = { id: string; start: number; end: number };

// Only ASCII word characters make "@" part of a word (emails, "a@b"); Chinese text often has no space before "@".
const ASCII_WORD = /[A-Za-z0-9_]/;

/**
 * Finds "@Name" mentions of known members, case-insensitive. Names may contain spaces or CJK, so each
 * "@" is matched against the longest member name it starts with instead of a fixed token pattern.
 * A legacy "@handle" still resolves so older instructions and messages keep working.
 */
export function findMentions(text: string, members: MentionCandidate[]): MentionMatch[] {
  const labels = members
    .flatMap(member => [member.name, member.handle ?? ''].map(label => ({ id: member.id, label: label.trim().toLowerCase() })))
    .filter(candidate => candidate.label)
    .sort((a, b) => b.label.length - a.label.length);
  const matches: MentionMatch[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const before = text[i - 1];
    if (before && (ASCII_WORD.test(before) || '@-.'.includes(before))) continue;
    for (const { id, label } of labels) {
      const end = i + 1 + label.length;
      if (text.slice(i + 1, end).toLowerCase() !== label) continue;
      const after = text[end];
      if (after && ASCII_WORD.test(label[label.length - 1]) && (ASCII_WORD.test(after) || after === '-')) continue;
      matches.push({ id, start: i, end });
      i = end - 1;
      break;
    }
  }
  return matches;
}

/** The distinct member ids mentioned in `text`, in order of first appearance. */
export function mentionIds(text: string, members: MentionCandidate[]): string[] {
  return [...new Set(findMentions(text, members).map(match => match.id))];
}
