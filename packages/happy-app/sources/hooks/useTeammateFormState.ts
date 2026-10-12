import React from 'react';
import type { Teammate } from 'happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';
import { TeammateApiError, createTeammate, updateTeammate } from '@/sync/apiTeammates';
import { encryptTeammateProfileEnv } from '@/sync/teammateRuntimeEnv';
import type { TeammateSeed } from '@/sync/teammateDraft';
import {
    buildTeammateFormRequest, changedTeammateFields, firstErrorSection, initialTeammateFormValues,
    type TeammateFormErrors, type TeammateFormSection, type TeammateFormValues,
} from '@/sync/teammateFormModel';
import { teammateErrorMessage } from '@/components/teammates/ui';
import { t } from '@/text';

export type TeammateSubmitResult =
    | { ok: true; teammate: Teammate }
    | { ok: false; section: TeammateFormSection | null };

/**
 * State for the Agent create/edit form. Values start from the edited Agent (or an AI seed) and are compared
 * against that starting point to find changed fields. `submit` validates, seals the profile environments for
 * the bound machine, saves, and re-wraps channel keys when an edited Agent moved machines. A failed re-wrap is
 * retried on the next submit even if nothing else changed.
 */
export function useTeammateFormState({ teammate, seed }: { teammate?: Teammate; seed?: TeammateSeed }) {
    const { credentials } = useAuth();
    const [initial, setInitial] = React.useState(() => initialTeammateFormValues({
        teammate, seed, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    }));
    const [values, setValues] = React.useState(initial);
    const [errors, setErrors] = React.useState<TeammateFormErrors>({});
    const [error, setError] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    const rewrapPending = React.useRef(false);
    const changed = React.useMemo(() => changedTeammateFields(initial, values), [initial, values]);

    const set = React.useCallback(<K extends keyof TeammateFormValues>(field: K, value: TeammateFormValues[K]) => {
        setValues(current => ({ ...current, [field]: value }));
        setErrors(current => {
            if (!current[field]) return current;
            const { [field]: _removed, ...rest } = current;
            return rest;
        });
    }, []);

    /** Sets a default without marking the form as changed (for example the first online machine). */
    const setDefault = React.useCallback(<K extends keyof TeammateFormValues>(field: K, value: TeammateFormValues[K]) => {
        setInitial(current => ({ ...current, [field]: value }));
        setValues(current => ({ ...current, [field]: value }));
    }, []);

    const reset = React.useCallback(() => {
        setValues(initial);
        setErrors({});
        setError(null);
    }, [initial]);

    const submit = async (): Promise<TeammateSubmitResult> => {
        if (!credentials || saving) return { ok: false, section: null };
        const result = buildTeammateFormRequest(values, teammate);
        setError(null);
        if (!result.ok) {
            setErrors(result.errors);
            setError(t('teammates.checkFields'));
            return { ok: false, section: firstErrorSection(result.errors) };
        }
        setErrors({});
        setSaving(true);
        try {
            // Profile environments may hold secrets, so they are sealed for the bound machine on every save;
            // a profile deleted since it was picked falls back to the machine's own configuration.
            const { request } = result;
            const [controllerEnv, workerEnv] = await Promise.all([values.controller, values.worker]
                .map(runtime => encryptTeammateProfileEnv(request.machineId, runtime.profileId || null, runtime.provider)));
            const sealed = {
                ...request, controllerEnv, workerEnv,
                controllerProfileId: controllerEnv && request.controllerProfileId, workerProfileId: workerEnv && request.workerProfileId,
            };
            const { handle: _handle, ...update } = sealed;
            const saved = teammate ? await updateTeammate(credentials, teammate.id, update) : await createTeammate(credentials, sealed);
            rewrapPending.current ||= !!teammate && teammate.machineId !== saved.machineId;
            storage.getState().applyTeammates([saved]);
            if (rewrapPending.current) {
                try {
                    await sync.channels.rewrapMember(saved);
                    rewrapPending.current = false;
                } catch {
                    setError(t('channels.rewrapError'));
                    return { ok: false, section: null };
                }
            }
            setInitial(values);
            return { ok: true, teammate: saved };
        } catch (failure) {
            if (failure instanceof TeammateApiError && failure.code === 'name_taken') {
                setErrors({ name: 'taken' });
                setError(t('teammates.checkFields'));
                return { ok: false, section: 'basic' };
            }
            setError(teammateErrorMessage(failure));
            return { ok: false, section: null };
        } finally {
            setSaving(false);
        }
    };

    return { values, initial, changed, errors, error, saving, canSave: !!credentials, set, setDefault, reset, submit };
}
