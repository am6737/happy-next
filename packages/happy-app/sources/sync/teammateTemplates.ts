/**
 * Starting points on the "new Agent" screen. With an online machine a template's prompt starts an AI draft;
 * without one its name, handle and role prefill the confirm form. All text lives under `teammates.create.templates`.
 */
export const TEAMMATE_TEMPLATES = [
    { id: 'review', handle: 'reviewer' },
    { id: 'triage', handle: 'triage' },
    { id: 'docs', handle: 'docs' },
] as const;

export type TeammateTemplate = typeof TEAMMATE_TEMPLATES[number];
