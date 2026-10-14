import { useEffect, useMemo, useState } from 'react';
import { machineListQoderModels, machineQoderModelDescriptions, type QoderModel, type QoderModelDescriptions } from '@/sync/ops';
import { loadQoderModelsByMachine, saveQoderModels } from '@/sync/persistence';
import { useLatestQoderModels } from '@/sync/storage';
import { getCurrentLanguage } from '@/text';

/** A Qoder model for the picker; `detail` is Qoder's own description, when known. */
export type QoderPickerModel = QoderModel & { detail?: string };

/** The models to show, and whether the machine's list is still on its way with nothing saved from before (the shown ones are then stand-ins). */
export type QoderModelsState = { models: QoderPickerModel[] | undefined; pending: boolean };

// Models and texts belong to the machine's Qoder install, so one lookup per machine serves every screen.
// Each machine's list is also saved, so after a reload the last one shows while the machine is asked again.
let modelsByMachine: Map<string, QoderModel[]> | null = null;
const modelsAnswered = new Set<string>();
function knownModels(machineId: string): QoderModel[] | undefined {
    modelsByMachine ??= new Map(Object.entries(loadQoderModelsByMachine()));
    return modelsByMachine.get(machineId);
}
const descriptionsByMachine = new Map<string, QoderModelDescriptions>();
const latestDescriptionsAsked = new Set<string>();

/**
 * Models a Qoder session on `machineId` can use, with their efforts and descriptions.
 *
 * Qoder lists models (and each model's efforts) per account and only through
 * qodercli, so they are asked from the machine, whose daemon keeps the list and
 * refreshes it from qodercli, once Qoder is selected, once per launch. Until that answer arrives the list
 * the machine gave last time is used; failing that, or if the machine can't answer,
 * the models the most recently updated Qoder session reported are, with `pending`
 * set so callers don't judge a saved choice against those stand-ins.
 *
 * ACP describes models with tags only. Qoder's sentences come from its text bundle:
 * the copy qodercli cached shows first, then the current bundle replaces it once
 * downloaded. Without either, models keep their tags.
 */
export function useQoderModels(machineId: string | null | undefined, directory: string, enabled: boolean): QoderModelsState {
    const latestSessionModels = useLatestQoderModels();
    const [machineModels, setMachineModels] = useState(() => (machineId ? knownModels(machineId) : undefined));
    // The machine + directory whose ask ended without models; the stand-ins are then all there is.
    const [unansweredKey, setUnansweredKey] = useState<string | null>(null);
    const [descriptions, setDescriptions] = useState(() => (machineId ? descriptionsByMachine.get(machineId) : undefined));

    useEffect(() => {
        setMachineModels(machineId ? knownModels(machineId) : undefined);
        if (!enabled || !machineId || !directory || modelsAnswered.has(machineId)) return;

        let cancelled = false;
        const key = `${machineId}\0${directory}`;
        machineListQoderModels(machineId, directory).then((result) => {
            if (!result.success || !result.models?.length) {
                if (!cancelled) setUnansweredKey(key);
                return;
            }
            modelsAnswered.add(machineId);
            modelsByMachine?.set(machineId, result.models);
            saveQoderModels(machineId, result.models);
            if (!cancelled) setMachineModels(result.models);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, directory, enabled]);

    useEffect(() => {
        setDescriptions(machineId ? descriptionsByMachine.get(machineId) : undefined);
        if (!enabled || !machineId || latestDescriptionsAsked.has(machineId)) return;
        latestDescriptionsAsked.add(machineId);

        let cancelled = false;
        let latestArrived = false;
        const show = (next: QoderModelDescriptions | null) => {
            if (!next) return;
            descriptionsByMachine.set(machineId, next);
            if (!cancelled) setDescriptions(next);
        };
        machineQoderModelDescriptions(machineId, 'cache').then((cached) => {
            if (!latestArrived) show(cached);
        });
        machineQoderModelDescriptions(machineId, 'latest').then((latest) => {
            latestArrived = !!latest;
            show(latest);
            // A failed download is asked again next time Qoder is picked.
            if (!latest) latestDescriptionsAsked.delete(machineId);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, enabled]);

    const models = machineModels ?? latestSessionModels;
    const described = useMemo(() => {
        if (!descriptions) return models;
        const texts = getCurrentLanguage().startsWith('zh') ? descriptions.zh : descriptions.en;
        return models?.map((model) => ({ ...model, detail: texts[model.code] ?? descriptions.en[model.code] }));
    }, [models, descriptions]);
    const pending = enabled && !!machineId && !!directory && !knownModels(machineId) && unansweredKey !== `${machineId}\0${directory}`;
    return { models: described, pending };
}
