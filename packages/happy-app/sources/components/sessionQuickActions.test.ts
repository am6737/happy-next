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
});
