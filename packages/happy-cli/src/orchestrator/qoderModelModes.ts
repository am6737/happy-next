import { MODEL_MODE_DEFAULT, buildQoderModelMode } from 'happy-wire';

// The daemon keeps the list and spends at most 15s asking qodercli for a new one
const QODER_MODELS_TIMEOUT_MS = 20_000;

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
    try {
        return qoderModelModesFromListing(await call(`${machineId}:qoder-list-models`, {}, QODER_MODELS_TIMEOUT_MS));
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
