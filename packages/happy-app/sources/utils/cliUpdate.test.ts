import { describe, it, expect, vi } from 'vitest';
import type { Machine } from '@/sync/storageTypes';

vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({ machines: {} }), subscribe: () => () => {} } }));
vi.mock('@/sync/ops', () => ({ machineCheckCliUpdate: vi.fn() }));

import { getMachineCliUpdate, getSessionCliUpgrade } from './cliUpdate';

function machine(running: string, cliUpdate: Record<string, unknown> | undefined, active = true): Machine {
    return {
        id: 'm1',
        active,
        metadata: { happyCliVersion: running },
        daemonState: { status: 'running', cliUpdate },
    } as unknown as Machine;
}

describe('getMachineCliUpdate', () => {
    it('offers a newer published version', () => {
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'idle', latestVersion: '0.13.0' }))).toEqual({ state: 'available', version: '0.13.0' });
        expect(getMachineCliUpdate(machine('0.13.0', { state: 'idle', latestVersion: '0.13.0' }))).toEqual({ state: 'none' });
    });

    it('reads what 0.12 daemons report the same way', () => {
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'available', waitingFor: 'sessions', latestVersion: '0.13.0' }))).toEqual({ state: 'available', version: '0.13.0' });
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'up-to-date', latestVersion: '0.12.0' }))).toEqual({ state: 'none' });
    });

    it('keeps an install shown while the daemon restarts offline, and drops it once the new version runs', () => {
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'installing', targetVersion: '0.13.0' }, false))).toEqual({ state: 'installing', version: '0.13.0' });
        expect(getMachineCliUpdate(machine('0.13.0', { state: 'installing', targetVersion: '0.13.0' }))).toEqual({ state: 'none' });
    });

    it('reports a failed install with its error, only while the machine is online', () => {
        const failed = { state: 'failed', targetVersion: '0.13.0', error: 'EACCES' };
        expect(getMachineCliUpdate(machine('0.12.0', failed))).toEqual({ state: 'failed', version: '0.13.0', error: 'EACCES' });
        expect(getMachineCliUpdate(machine('0.12.0', failed, false))).toEqual({ state: 'none' });
    });

    it('says nothing for daemons that report no update state', () => {
        expect(getMachineCliUpdate(machine('0.11.0', undefined))).toEqual({ state: 'none' });
        expect(getMachineCliUpdate(null)).toEqual({ state: 'none' });
    });
});

describe('getSessionCliUpgrade', () => {
    it('is the daemon version when it is newer than the session', () => {
        expect(getSessionCliUpgrade('0.12.0', machine('0.13.0', undefined))).toBe('0.13.0');
        expect(getSessionCliUpgrade('0.13.0', machine('0.13.0', undefined))).toBeNull();
        expect(getSessionCliUpgrade(undefined, machine('0.13.0', undefined))).toBeNull();
    });
});
