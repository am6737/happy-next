import {
    TeammateCreateRequestSchema, TEAMMATE_HANDLE_REGEX,
    type PermissionMode, type Teammate, type TeammateControllerProvider, type TeammateCreateRequest, type TeammateCreateRequestParsed, type TeammateWorkerProvider,
} from 'happy-wire';
import type { TeammateSeed } from './teammateDraft';
import { buildTeammateSchedulePayload } from './teammateSchedule';

export type TeammateRuntimeValue<P extends TeammateWorkerProvider = TeammateWorkerProvider> = {
    provider: P;
    /** Model catalog mode, optionally `-fast`; '' means the provider default. */
    model: string;
    permissionMode: PermissionMode;
    /** '' means the machine's own configuration. */
    profileId: string;
};

export type TeammateFormValues = {
    name: string;
    /** Slug hint from a template or AI draft; the server allocates the internal handle and never shows it. */
    handle: string;
    color: string;
    role: string;
    skills: string[];
    repos: string[];
    instructions: string;
    machineId: string;
    controller: TeammateRuntimeValue<TeammateControllerProvider>;
    worker: TeammateRuntimeValue;
    maxConcurrentRuns: number;
    canSelfAssign: boolean;
    contextAutoRollover: boolean;
    /** Free text so a half-typed amount survives; '' uses the daemon default. */
    contextBudgetTokens: string;
    /** Free text so a half-typed amount survives; '' means no budget. */
    monthlyBudgetUsd: string;
    heartbeatIntervalMin: number | null;
    activeHoursEnabled: boolean;
    activeHoursStart: string;
    activeHoursEnd: string;
    /** 0 = Sunday; all seven days are sent as "no day restriction". */
    activeDays: number[];
    timezone: string;
    dreamingHour: number | null;
};

export type TeammateFormField = keyof TeammateFormValues;

/** Basic info and instructions stay visible; runtime and schedule live under the collapsed "advanced" card. */
export type TeammateFormSection = 'basic' | 'instructions' | 'runtime' | 'schedule';

export type TeammateFormError = 'required' | 'invalid' | 'taken' | 'timezone' | 'hours' | 'days';

export type TeammateFormErrors = Partial<Record<TeammateFormField, TeammateFormError>>;

export const TEAMMATE_DEFAULT_COLOR = '#5B6EF5';
export const TEAMMATE_HEARTBEAT_PRESETS = [null, 15, 60, 240] as const;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const HOUR_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const SECTIONS: Record<TeammateFormField, TeammateFormSection> = {
    name: 'basic', handle: 'basic', color: 'basic', role: 'basic', skills: 'basic', repos: 'basic', machineId: 'basic',
    instructions: 'instructions',
    controller: 'runtime', worker: 'runtime', maxConcurrentRuns: 'runtime', canSelfAssign: 'runtime', contextAutoRollover: 'runtime', contextBudgetTokens: 'runtime',
    monthlyBudgetUsd: 'schedule', heartbeatIntervalMin: 'schedule', activeHoursEnabled: 'schedule', activeHoursStart: 'schedule',
    activeHoursEnd: 'schedule', activeDays: 'schedule', timezone: 'schedule', dreamingHour: 'schedule',
};

const SECTION_ORDER: TeammateFormSection[] = ['basic', 'instructions', 'runtime', 'schedule'];

// Request keys that do not share a name with a form field.
const REQUEST_FIELDS: Record<string, TeammateFormField> = {
    avatar: 'color',
    controllerProvider: 'controller', controllerModel: 'controller', controllerPermissionMode: 'controller', controllerProfileId: 'controller',
    workerProvider: 'worker', model: 'worker', workerPermissionMode: 'worker', workerProfileId: 'worker',
    activeHours: 'activeHoursStart',
};

export function teammateFormSection(field: TeammateFormField): TeammateFormSection {
    return SECTIONS[field];
}

export function isAdvancedSection(section: TeammateFormSection): boolean {
    return section === 'runtime' || section === 'schedule';
}

/** The section holding the first failing field in page order, or null when there are no errors. */
export function firstErrorSection(errors: TeammateFormErrors): TeammateFormSection | null {
    const sections = new Set((Object.keys(errors) as TeammateFormField[]).map(teammateFormSection));
    return SECTION_ORDER.find(section => sections.has(section)) ?? null;
}

/** Form values for editing `teammate`, or for a new Agent prefilled from an AI `seed`. */
export function initialTeammateFormValues({ teammate, seed, machineId = '', timezone, currencyRate = 1 }: {
    teammate?: Teammate; seed?: TeammateSeed; machineId?: string; timezone: string; currencyRate?: number;
}): TeammateFormValues {
    const draft = seed?.draft;
    return {
        name: teammate?.name ?? draft?.name ?? '',
        handle: teammate?.handle ?? draft?.handle ?? '',
        color: teammate?.avatar?.color ?? draft?.avatar?.color ?? TEAMMATE_DEFAULT_COLOR,
        role: teammate?.role ?? draft?.role ?? '',
        // Skills are picked from the machine; a drafted Agent never carries any.
        skills: teammate?.skills ?? [],
        repos: teammate?.repos ?? [],
        instructions: teammate?.instructions ?? draft?.instructions ?? '',
        machineId: teammate?.machineId ?? seed?.machineId ?? machineId,
        controller: {
            provider: teammate?.controllerProvider ?? 'claude', model: teammate?.controllerModel ?? '',
            permissionMode: teammate?.controllerPermissionMode ?? 'default', profileId: teammate?.controllerProfileId ?? '',
        },
        worker: {
            provider: teammate?.workerProvider ?? 'claude', model: teammate?.model ?? '',
            permissionMode: teammate?.workerPermissionMode ?? 'default', profileId: teammate?.workerProfileId ?? '',
        },
        maxConcurrentRuns: teammate?.maxConcurrentRuns ?? 3,
        canSelfAssign: teammate?.canSelfAssign ?? false,
        contextAutoRollover: teammate?.contextAutoRollover ?? true,
        contextBudgetTokens: teammate?.contextBudgetTokens?.toString() ?? '',
        monthlyBudgetUsd: teammate?.monthlyBudgetUsd == null ? '' : (Math.round(teammate.monthlyBudgetUsd * currencyRate * 100) / 100).toString(),
        heartbeatIntervalMin: teammate?.heartbeatIntervalMin ?? null,
        activeHoursEnabled: !!teammate?.activeHours,
        activeHoursStart: teammate?.activeHours?.start ?? '09:00',
        activeHoursEnd: teammate?.activeHours?.end ?? '18:00',
        activeDays: teammate?.activeHours?.days ?? ALL_DAYS,
        timezone: teammate?.timezone ?? teammate?.activeHours?.timezone ?? timezone,
        dreamingHour: teammate?.dreamingHour ?? null,
    };
}

/** Fields whose value differs from `initial`, in declaration order. */
export function changedTeammateFields(initial: TeammateFormValues, current: TeammateFormValues): TeammateFormField[] {
    return (Object.keys(initial) as TeammateFormField[]).filter(field => JSON.stringify(initial[field]) !== JSON.stringify(current[field]));
}

function isValidTimezone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format();
        return true;
    } catch {
        return false;
    }
}

export type TeammateFormResult =
    | { ok: true; request: TeammateCreateRequestParsed }
    | { ok: false; errors: TeammateFormErrors };

/**
 * Validates the form and builds the create request; editing drops the handle hint from it before sending.
 * `avatar` keeps any non-color avatar fields of the Agent being edited.
 */
export function buildTeammateFormRequest(values: TeammateFormValues, teammate?: Teammate, currencyRate = 1): TeammateFormResult {
    const errors: TeammateFormErrors = {};
    if (!values.name.trim()) errors.name = 'required';
    if (!values.machineId) errors.machineId = 'required';
    if (!isValidTimezone(values.timezone)) errors.timezone = 'timezone';
    if (values.activeHoursEnabled && (!HOUR_REGEX.test(values.activeHoursStart) || !HOUR_REGEX.test(values.activeHoursEnd))) errors.activeHoursStart = 'hours';
    if (values.activeHoursEnabled && !values.activeDays.length) errors.activeDays = 'days';

    const allDays = ALL_DAYS.every(day => values.activeDays.includes(day));
    const body: TeammateCreateRequest = {
        name: values.name.trim(), handle: TEAMMATE_HANDLE_REGEX.test(values.handle) ? values.handle : undefined, avatar: { ...teammate?.avatar, color: values.color },
        role: values.role.trim(), skills: values.skills, repos: values.repos, instructions: values.instructions,
        machineId: values.machineId,
        controllerProvider: values.controller.provider, controllerModel: values.controller.model || null,
        controllerPermissionMode: values.controller.permissionMode, controllerProfileId: values.controller.profileId || null,
        workerProvider: values.worker.provider, model: values.worker.model || null,
        workerPermissionMode: values.worker.permissionMode, workerProfileId: values.worker.profileId || null,
        maxConcurrentRuns: values.maxConcurrentRuns, canSelfAssign: values.canSelfAssign,
        contextAutoRollover: values.contextAutoRollover,
        // Hidden while auto segment is off: omit it so the stored budget is kept and a stale draft can't block saving.
        contextBudgetTokens: !values.contextAutoRollover ? undefined : values.contextBudgetTokens.trim() ? Number(values.contextBudgetTokens) : null,
        monthlyBudgetUsd: values.monthlyBudgetUsd.trim() ? Number(values.monthlyBudgetUsd) / currencyRate : null,
        heartbeatIntervalMin: values.heartbeatIntervalMin,
        ...buildTeammateSchedulePayload(values.timezone, values.activeHoursEnabled, values.activeHoursStart, values.activeHoursEnd,
            allDays ? undefined : [...values.activeDays].sort()),
        dreamingHour: values.dreamingHour,
    };
    const parsed = TeammateCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            const key = String(issue.path[0]);
            const field = REQUEST_FIELDS[key] ?? key as TeammateFormField;
            if (field in SECTIONS) errors[field] ??= 'invalid';
        }
    }
    if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, request: parsed.data };
}
