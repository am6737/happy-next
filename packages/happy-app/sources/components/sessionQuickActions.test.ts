import { describe, expect, it } from 'vitest';
import { Session } from '@/sync/storageTypes';
import { getSessionQuickActionKinds } from './sessionQuickActions';

function session(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        metadataVersion: 1,
        metadata: {
            machineId: 'machine-1',
            path: '/project',
            claudeSessionId: 'claude-1',
        },
        ...overrides,
    } as Session;
}

describe('getSessionQuickActionKinds', () => {
    it('includes owner actions for a connected session', () => {
        expect(getSessionQuickActionKinds({
            session: session(),
            hasOrchestratorRuns: true,
            isConnected: true,
        })).toEqual([
            'details',
            'newSession',
            'delegationHistory',
            'manageSharing',
            'viewMachine',
            'forkSession',
            'archiveSession',
        ]);
    });

    it('offers delete instead of archive for an inactive disconnected session', () => {
        expect(getSessionQuickActionKinds({
            session: session({ active: false }),
            hasOrchestratorRuns: false,
            isConnected: false,
        })).toContain('deleteSession');
    });

    it('limits shared sessions to shared-session actions', () => {
        expect(getSessionQuickActionKinds({
            session: session({ accessLevel: 'view' }),
            hasOrchestratorRuns: false,
            isConnected: true,
        })).toEqual(['details', 'newSession', 'leaveSharedSession']);
    });

    it('retains native archive after stopping Codex and rebuilding the menu', () => {
        const current = session();
        current.metadata = { ...current.metadata!, flavor: 'codex', codexSessionId: 'native-1' };
        expect(getSessionQuickActionKinds({ session: current, hasOrchestratorRuns: false, isConnected: true })).toContain('archiveSession');
        current.active = false;
        current.metadata.lifecycleState = 'archived';
        const actions = getSessionQuickActionKinds({ session: current, hasOrchestratorRuns: false, isConnected: false });
        expect(actions).toContain('archiveSession');
        expect(actions).toContain('deleteSession');
    });

    it.each(['view', 'edit', 'admin'] as const)('does not offer native retry to shared %s users', accessLevel => {
        const current = session({ active: false, accessLevel });
        current.metadata = { ...current.metadata!, flavor: 'codex' };
        expect(getSessionQuickActionKinds({ session: current, hasOrchestratorRuns: false, isConnected: false })).not.toContain('archiveSession');
    });
});
