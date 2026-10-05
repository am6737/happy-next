export type ParsedOrchestratorContext = {
    controllerSessionId?: string;
    machineId?: string;
    workingDirectory?: string;
    defaults?: {
        mode?: string;
        maxConcurrency?: number;
        waitTimeoutMs?: number;
        pollIntervalMs?: number;
        retryMaxAttempts?: number;
        retryBackoffMs?: number;
    };
    providers: string[];
    modelModes: Record<string, string[]>;
    machines: Array<{
        machineId?: string;
        name?: string;
        providers?: string[];
        active?: boolean;
        online?: boolean;
        dispatchReady?: boolean;
        lastActiveAt?: string;
    }>;
};

export type ModelModeGroup = {
    model: string;
    /** Reasoning efforts offered for the model, in the order the server listed them; empty when it has none. */
    efforts: string[];
};

const EFFORT_SUFFIX = /^(.+)-(low|medium|high|xhigh|max|ultra)$/;

/**
 * Fold the flat mode list the server sends (`gpt-5.5-low`, `gpt-5.5-high`, `default`, …) into
 * one entry per model with its efforts, so a provider reads as a few models instead of a wall
 * of near-identical strings. Order of first appearance is kept.
 */
export function groupModelModes(modes: readonly string[]): ModelModeGroup[] {
    const groups = new Map<string, string[]>();
    for (const mode of modes) {
        const match = EFFORT_SUFFIX.exec(mode);
        const model = match ? match[1] : mode;
        const efforts = groups.get(model) ?? [];
        if (match && !efforts.includes(match[2])) {
            efforts.push(match[2]);
        }
        groups.set(model, efforts);
    }
    return [...groups].map(([model, efforts]) => ({ model, efforts }));
}

export type ContextDefaultKey = 'mode' | 'maxConcurrency' | 'waitTimeout' | 'pollInterval' | 'retryMaxAttempts' | 'retryBackoff';

export type ContextDefaultEntry = {
    key: ContextDefaultKey;
    kind: 'text' | 'count' | 'duration';
    /** Text, a count, or milliseconds, according to `kind`. */
    value: string | number;
};

/** The defaults the server reported, in a fixed reading order, skipping the ones it left out. */
export function getContextDefaultEntries(defaults: ParsedOrchestratorContext['defaults']): ContextDefaultEntry[] {
    if (!defaults) {
        return [];
    }
    const entries: Array<ContextDefaultEntry | null> = [
        defaults.mode ? { key: 'mode', kind: 'text', value: defaults.mode } : null,
        typeof defaults.maxConcurrency === 'number' ? { key: 'maxConcurrency', kind: 'count', value: defaults.maxConcurrency } : null,
        typeof defaults.waitTimeoutMs === 'number' ? { key: 'waitTimeout', kind: 'duration', value: defaults.waitTimeoutMs } : null,
        typeof defaults.pollIntervalMs === 'number' ? { key: 'pollInterval', kind: 'duration', value: defaults.pollIntervalMs } : null,
        typeof defaults.retryMaxAttempts === 'number' ? { key: 'retryMaxAttempts', kind: 'count', value: defaults.retryMaxAttempts } : null,
        typeof defaults.retryBackoffMs === 'number' ? { key: 'retryBackoff', kind: 'duration', value: defaults.retryBackoffMs } : null,
    ];
    return entries.filter((entry): entry is ContextDefaultEntry => entry !== null);
}

export type ContextMachineStatus = 'ready' | 'notReady' | 'offline';

/** Ready to take a dispatch; connected but not yet registered for dispatch; or not connected. */
export function resolveContextMachineStatus(machine: Pick<ParsedOrchestratorContext['machines'][number], 'online' | 'dispatchReady'>): ContextMachineStatus {
    if (machine.dispatchReady) {
        return 'ready';
    }
    return machine.online ? 'notReady' : 'offline';
}
