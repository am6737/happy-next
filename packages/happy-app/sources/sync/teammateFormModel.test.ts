import { describe, expect, it } from 'vitest';
import { TeammateSchema, type Teammate } from 'happy-wire';

import {
    buildTeammateFormRequest, changedTeammateFields, firstErrorSection, initialTeammateFormValues, isAdvancedSection,
    teammateFormSection, type TeammateFormValues,
} from './teammateFormModel';

function teammate(fields: Partial<Teammate> = {}): Teammate {
    return TeammateSchema.parse({
        id: 'tm', handle: 'reviewer', name: 'Reviewer', avatar: { emoji: '🔍', color: '#22C55E' }, role: 'Code review', skills: ['review'], repos: ['org/app'], instructions: 'Review PRs.',
        machineId: 'machine', controllerProvider: 'claude', controllerModel: null, controllerPermissionMode: 'default', controllerProfileId: null, controllerEnv: null, workerProvider: 'codex', model: 'gpt-5', workerPermissionMode: 'default', workerProfileId: null, workerEnv: null, maxConcurrentRuns: 3,
        monthlyBudgetUsd: 20, heartbeatIntervalMin: 60, activeHours: null, timezone: 'Asia/Shanghai', dreamingHour: 3, canSelfAssign: false,
        status: 'active', createdAt: 0, updatedAt: 0, ...fields,
    });
}

function create(fields: Partial<TeammateFormValues> = {}): TeammateFormValues {
    return { ...initialTeammateFormValues({ machineId: 'machine', timezone: 'UTC' }), name: 'Atlas', handle: 'atlas', ...fields };
}

describe('initialTeammateFormValues', () => {
    it('starts a blank Agent on the given machine with heartbeat and dreaming off', () => {
        const values = initialTeammateFormValues({ machineId: 'm1', timezone: 'Europe/Rome' });
        expect(values).toMatchObject({ name: '', machineId: 'm1', timezone: 'Europe/Rome', heartbeatIntervalMin: null, dreamingHour: null, activeHoursEnabled: false, maxConcurrentRuns: 3, contextAutoRollover: true, contextBudgetTokens: '' });
        expect(values.activeDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
    it('prefills from an AI seed but never carries drafted skills', () => {
        const values = initialTeammateFormValues({
            seed: { machineId: 'm2', draft: { name: 'Scout', handle: 'scout', role: 'Triage', skills: ['triage'], instructions: 'Label issues.', avatar: { color: '#EC4899' } } },
            machineId: 'm1', timezone: 'UTC',
        });
        expect(values).toMatchObject({ name: 'Scout', handle: 'scout', role: 'Triage', instructions: 'Label issues.', color: '#EC4899', machineId: 'm2', skills: [] });
    });
    it('mirrors an existing Agent', () => {
        const values = initialTeammateFormValues({ teammate: teammate({ contextAutoRollover: false, contextBudgetTokens: 90000, activeHours: { start: '10:00', end: '19:00', timezone: 'Asia/Shanghai', days: [1, 2] } }), timezone: 'UTC' });
        expect(values).toMatchObject({
            handle: 'reviewer', color: '#22C55E', monthlyBudgetUsd: '20', contextAutoRollover: false, contextBudgetTokens: '90000', heartbeatIntervalMin: 60, dreamingHour: 3, timezone: 'Asia/Shanghai',
            activeHoursEnabled: true, activeHoursStart: '10:00', activeHoursEnd: '19:00', activeDays: [1, 2],
            worker: { provider: 'codex', model: 'gpt-5', permissionMode: 'default', profileId: '' },
        });
    });
    it('converts a yuan budget without losing its displayed value on save', () => {
        const values = initialTeammateFormValues({ teammate: teammate({ monthlyBudgetUsd: 100 / 7.2 }), timezone: 'UTC', currencyRate: 7.2 });
        expect(values.monthlyBudgetUsd).toBe('100');
        const saved = buildTeammateFormRequest(values, teammate(), 7.2);
        expect(saved.ok && saved.request.monthlyBudgetUsd).toBeCloseTo(100 / 7.2);
    });
});

describe('changedTeammateFields', () => {
    it('reports nothing for an untouched form and compares arrays and runtimes by value', () => {
        const initial = initialTeammateFormValues({ teammate: teammate(), timezone: 'UTC' });
        expect(changedTeammateFields(initial, { ...initial, skills: ['review'], worker: { ...initial.worker } })).toEqual([]);
        expect(changedTeammateFields(initial, { ...initial, monthlyBudgetUsd: '30', worker: { ...initial.worker, model: '' } })).toEqual(['worker', 'monthlyBudgetUsd']);
        expect(changedTeammateFields(initial, { ...initial, contextBudgetTokens: '90000' })).toEqual(['contextBudgetTokens']);
        expect(changedTeammateFields(initial, { ...initial, contextAutoRollover: false })).toEqual(['contextAutoRollover']);
    });
});

describe('sections', () => {
    it('groups runtime and schedule fields as advanced', () => {
        expect(teammateFormSection('machineId')).toBe('basic');
        expect(teammateFormSection('controller')).toBe('runtime');
        expect(teammateFormSection('contextAutoRollover')).toBe('runtime');
        expect(teammateFormSection('contextBudgetTokens')).toBe('runtime');
        expect(teammateFormSection('dreamingHour')).toBe('schedule');
        expect(isAdvancedSection('runtime')).toBe(true);
        expect(isAdvancedSection('instructions')).toBe(false);
    });
    it('picks the earliest failing section in page order', () => {
        expect(firstErrorSection({})).toBeNull();
        expect(firstErrorSection({ monthlyBudgetUsd: 'invalid', instructions: 'invalid' })).toBe('instructions');
        expect(firstErrorSection({ timezone: 'timezone', worker: 'invalid' })).toBe('runtime');
    });
});

describe('buildTeammateFormRequest', () => {
    it('builds a create request with nulls for empty optional values', () => {
        const result = buildTeammateFormRequest(create({ name: '  Atlas  ', role: ' Builder ' }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.request).toMatchObject({
            name: 'Atlas', handle: 'atlas', role: 'Builder', avatar: { color: '#5B6EF5' }, machineId: 'machine',
            controllerModel: null, model: null, controllerProfileId: null, contextAutoRollover: true, contextBudgetTokens: null, monthlyBudgetUsd: null, heartbeatIntervalMin: null, dreamingHour: null,
            timezone: 'UTC', activeHours: null,
        });
    });
    it('keeps other avatar fields of the edited Agent', () => {
        const existing = teammate();
        const result = buildTeammateFormRequest({ ...initialTeammateFormValues({ teammate: existing, timezone: 'UTC' }), color: '#0EA5E9' }, existing);
        expect(result.ok && result.request.avatar).toEqual({ emoji: '🔍', color: '#0EA5E9' });
    });
    it('sends a numeric context budget and maps out-of-range values to the runtime field', () => {
        const valid = buildTeammateFormRequest(create({ contextBudgetTokens: ' 90000 ' }));
        expect(valid.ok && valid.request.contextBudgetTokens).toBe(90000);
        for (const contextBudgetTokens of ['9999', '1000001']) {
            const invalid = buildTeammateFormRequest(create({ contextBudgetTokens }));
            expect(invalid.ok).toBe(false);
            if (invalid.ok) continue;
            expect(invalid.errors.contextBudgetTokens).toBe('invalid');
            expect(firstErrorSection(invalid.errors)).toBe('runtime');
        }
    });
    it('omits the hidden context budget when automatic segmentation is off so the stored value is kept', () => {
        for (const contextBudgetTokens of ['90000', '9999']) {
            const result = buildTeammateFormRequest(create({ contextAutoRollover: false, contextBudgetTokens }));
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.request.contextAutoRollover).toBe(false);
            expect(result.request.contextBudgetTokens).toBeUndefined();
        }
    });
    it('omits days when every day is selected and sorts a partial selection', () => {
        const all = buildTeammateFormRequest(create({ activeHoursEnabled: true }));
        expect(all.ok && all.request.activeHours).toEqual({ start: '09:00', end: '18:00', timezone: 'UTC' });
        const some = buildTeammateFormRequest(create({ activeHoursEnabled: true, activeDays: [5, 1, 3] }));
        expect(some.ok && some.request.activeHours?.days).toEqual([1, 3, 5]);
    });
    it('reports required, timezone, hours and day errors on their fields', () => {
        const result = buildTeammateFormRequest(create({
            name: ' ', handle: 'A', machineId: '', timezone: 'Mars/Base', activeHoursEnabled: true, activeHoursStart: '9:00', activeDays: [],
        }));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toMatchObject({ name: 'required', machineId: 'required', timezone: 'timezone', activeHoursStart: 'hours', activeDays: 'days' });
    });
    it('maps schema failures back to form fields', () => {
        const result = buildTeammateFormRequest(create({ monthlyBudgetUsd: 'abc', heartbeatIntervalMin: 2, repos: ['not a repo'], worker: { provider: 'claude', model: 'x'.repeat(101), permissionMode: 'default', profileId: '' } }));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toEqual({ monthlyBudgetUsd: 'invalid', heartbeatIntervalMin: 'invalid', repos: 'invalid', worker: 'invalid' });
        expect(firstErrorSection(result.errors)).toBe('basic');
    });
});

describe('handle hint', () => {
    it('sends a valid hint, drops an invalid one and rejects "@" in names', () => {
        const valid = buildTeammateFormRequest(create({ name: '审查员', handle: 'reviewer' }));
        expect(valid.ok && valid.request.handle).toBe('reviewer');
        const invalid = buildTeammateFormRequest(create({ name: '审查员', handle: 'A' }));
        expect(invalid.ok && invalid.request.handle).toBeUndefined();
        const at = buildTeammateFormRequest(create({ name: '@审查员' }));
        expect(!at.ok && at.errors.name).toBe('invalid');
    });
});
