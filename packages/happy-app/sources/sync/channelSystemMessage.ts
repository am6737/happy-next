import { TEAMMATE_RUN_FAILURE_REASONS, type ChannelMessageContent, type TeammateRunFailureReason } from 'happy-wire';

export type GovernanceSystemMessage =
    | { code: 'budget_warning'; spentUsd: string; budgetUsd: string; taskId: null }
    | { code: 'budget_paused' | 'budget_resumed'; taskId: null }
    | { code: 'task_self_assigned'; agent: string; title: string; taskId: string | null }
    | { code: 'run_failed'; name: string; reason: TeammateRunFailureReason; runId: string | null; taskId: null };

export function governanceSystemMessage(content: ChannelMessageContent): GovernanceSystemMessage | null {
    if (content.t !== 'system') return null;
    const data = content.data;
    switch (content.code) {
        case 'budget_warning':
            return { code: content.code, spentUsd: money(data.spentUsd), budgetUsd: money(data.budgetUsd), taskId: null };
        case 'budget_paused':
        case 'budget_resumed':
            return { code: content.code, taskId: null };
        case 'task_self_assigned':
            return { code: content.code, agent: typeof data.byHandle === 'string' && data.byHandle ? `@${data.byHandle}` : '',
                title: typeof data.title === 'string' ? data.title : '', taskId: typeof data.taskId === 'string' && data.taskId ? data.taskId : null };
        case 'run_failed':
            return { code: content.code, name: typeof data.name === 'string' ? data.name : '',
                reason: TEAMMATE_RUN_FAILURE_REASONS.find(reason => reason === data.reason) ?? 'unknown',
                runId: typeof data.runId === 'string' && data.runId ? data.runId : null, taskId: null };
        default: return null;
    }
}

function money(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '$0.00';
}
