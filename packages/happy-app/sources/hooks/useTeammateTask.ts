import React from 'react';
import { useFocusEffect } from 'expo-router';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';

/** Watches only focused task panels; TaskSync retries and applies account-scoped snapshots. */
export function useTeammateTask(id: string) {
    useFocusEffect(React.useCallback(() => sync.tasks.watch('task', id), [id]));
    return storage(state => state.teammateTaskDetails[id]);
}
/** Task ids for one issue, newest first; `undefined` until the first snapshot for it has loaded. */
export function useTeammateIssueTasks(resourceId: string): string[] | undefined {
    useFocusEffect(React.useCallback(() => sync.tasks.watch('resource', resourceId), [resourceId]));
    return storage(state => state.teammateTaskResourceIndex[resourceId]);
}
