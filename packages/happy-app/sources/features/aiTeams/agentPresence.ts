import type { AiAgent, AiWorkItem } from './mockData';

export type AiAgentAvailability = 'online' | 'unstable' | 'offline' | 'archived';
export type AiAgentWorkload = 'working' | 'queued' | 'idle';

export type AiAgentPresence = {
    availability: AiAgentAvailability;
    workload: AiAgentWorkload;
    runningCount: number;
    queuedCount: number;
    capacity: number;
};

const queuedWorkStatuses = new Set<AiWorkItem['status']>(['todo', 'blocked', 'review']);

export function deriveAiAgentPresence(agent: AiAgent, workItems: AiWorkItem[] = []): AiAgentPresence {
    const capacity = agent.settings.maxConcurrentTasks;
    const archived = agent.enabled === false || agent.availability === 'archived';
    if (archived) {
        return { availability: 'archived', workload: 'idle', runningCount: 0, queuedCount: 0, capacity };
    }

    const availability = agent.availability ?? 'online';
    const assignedWork = workItems.filter((work) => work.assigneeId === agent.id);
    const runningCount = assignedWork.filter((work) => work.status === 'working').length;
    const queuedCount = assignedWork.filter((work) => queuedWorkStatuses.has(work.status)).length;

    let workload: AiAgentWorkload;
    if (runningCount > 0) {
        workload = 'working';
    } else if (queuedCount > 0) {
        workload = 'queued';
    } else if (agent.status === 'working') {
        workload = 'working';
    } else if (agent.status === 'waiting' || agent.status === 'reviewing') {
        workload = 'queued';
    } else {
        workload = 'idle';
    }

    return { availability, workload, runningCount, queuedCount, capacity };
}

export function getAiAgentAvailabilityLabel(availability: AiAgentAvailability, isZh: boolean): string {
    const labels = isZh
        ? { online: '在线', unstable: '连接不稳定', offline: '离线', archived: '已归档' }
        : { online: 'Online', unstable: 'Unstable', offline: 'Offline', archived: 'Archived' };
    return labels[availability];
}

export function getAiAgentWorkloadLabel(workload: AiAgentWorkload, isZh: boolean): string {
    const labels = isZh
        ? { working: '工作中', queued: '排队中', idle: '空闲' }
        : { working: 'Working', queued: 'Queued', idle: 'Idle' };
    return labels[workload];
}

export function getAiAgentPresenceLabel(presence: AiAgentPresence, isZh: boolean): string {
    const availability = getAiAgentAvailabilityLabel(presence.availability, isZh);
    if (presence.availability === 'archived') return availability;
    return `${availability} · ${getAiAgentWorkloadLabel(presence.workload, isZh)}`;
}
