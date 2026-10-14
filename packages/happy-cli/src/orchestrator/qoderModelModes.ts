import { MODEL_MODE_DEFAULT, buildQoderModelMode } from 'happy-wire';

const QODER_MODELS_TIMEOUT_MS = 15_000;
const QODER_MODELS_CACHE_TTL_MS = 10 * 60_000;

/** Calls an RPC method another machine's daemon registered, e.g. `<machineId>:qoder-list-models`. */
export type MachineRpcCall = (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

type QoderModelsResponse = {
    success?: boolean;
    models?: Array<{ code?: unknown; efforts?: Array<{ code?: unknown }> }>;
};

type ContextMachine = {
    machineId?: unknown;
    online?: unknown;
    providers?: unknown;
    modelModes?: Record<string, unknown>;
};

const cache = new Map<string, { modes: string[]; expiresAt: number }>();

/** `default`, then every model code the listing has and each `code:effort`. */
export function qoderModelModesFromListing(response: unknown): string[] | null {
    const listing = response as QoderModelsResponse | null;
    if (!listing?.success || !Array.isArray(listing.models)) {
        return null;
    }
    const modes: string[] = [MODEL_MODE_DEFAULT];
    for (const model of listing.models) {
        if (typeof model?.code !== 'string' || !model.code) continue;
        modes.push(buildQoderModelMode(model.code, null));
        for (const effort of Array.isArray(model.efforts) ? model.efforts : []) {
            if (typeof effort?.code === 'string' && effort.code) {
                modes.push(buildQoderModelMode(model.code, effort.code));
            }
        }
    }
    return modes;
}

async function loadQoderModelModes(machineId: string, call: MachineRpcCall): Promise<string[] | null> {
    const cached = cache.get(machineId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.modes;
    }
    try {
        // No directory: the daemon lists from its home directory, as this machine knows none of its paths
        const modes = qoderModelModesFromListing(await call(`${machineId}:qoder-list-models`, {}, QODER_MODELS_TIMEOUT_MS));
        if (modes) {
            cache.set(machineId, { modes, expiresAt: Date.now() + QODER_MODELS_CACHE_TTL_MS });
        }
        return modes;
    } catch {
        return null;
    }
}

/**
 * Qoder models are per account, so the server, which takes them from the model
 * catalog, only knows `default`. Ask each online machine with Qoder for the models
 * its account offers and put them in its `modelModes.qoder`; a machine whose daemon
 * does not answer keeps what the server sent.
 */
export async function fillQoderModelModes<T extends ContextMachine>(machines: T[], call: MachineRpcCall): Promise<T[]> {
    return Promise.all(machines.map(async (machine) => {
        if (typeof machine.machineId !== 'string'
            || machine.online !== true
            || !Array.isArray(machine.providers)
            || !machine.providers.includes('qoder')) {
            return machine;
        }
        const modes = await loadQoderModelModes(machine.machineId, call);
        return modes ? { ...machine, modelModes: { ...machine.modelModes, qoder: modes } } : machine;
    }));
}

/** Test hook */
export function clearQoderModelModesCache(): void {
    cache.clear();
}
