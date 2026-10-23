import type { Machine, Session } from '@/sync/storageTypes';
import { t } from '@/text';

// The agent's name under a session, as the new-session page names it
const AGENTS: Record<string, 'claude' | 'codex' | 'gemini' | 'qoder'> = {
    claude: 'claude',
    codex: 'codex',
    openai: 'codex',
    gpt: 'codex',
    gemini: 'gemini',
    qoder: 'qoder',
};

function agentName(flavor: string | null | undefined): string {
    const agent = AGENTS[flavor ?? 'claude'];
    if (agent) return t(`agentInput.agent.${agent}`);
    return flavor ? flavor[0].toUpperCase() + flavor.slice(1) : '';
}

/** Each machine's name by its id, for shareSessionSubtitle. */
export function machineNames(machines: Machine[]): Map<string, string> {
    return new Map(machines.map((machine) => [
        machine.id,
        machine.metadata?.displayName || machine.metadata?.host || '',
    ]));
}

/**
 * The line under a session where shared content is sent (the share-target page and the iOS share
 * extension's sheet): its project, AI and machine.
 */
export function shareSessionSubtitle(session: Session, machines: Map<string, string>): string {
    const project = (session.metadata?.path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
    const machine = machines.get(session.metadata?.machineId ?? '');
    return [project, agentName(session.metadata?.flavor), machine].filter(Boolean).join(' · ');
}
