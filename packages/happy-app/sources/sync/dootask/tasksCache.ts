import type { DooTaskFilters, DooTaskItem, DooTaskPager, DooTaskProfile } from './types';

export type DooTaskTasksCacheEntry = { tasks: DooTaskItem[]; pager: DooTaskPager };

export const DOOTASK_TASKS_CACHE_MAX_SIZE = 10;
export const DOOTASK_TASKS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cache key for the first page of the task list. Free-text searches are not
 * cached so they cannot evict the regular filter combinations.
 */
export function dootaskTasksCacheKey(
    profile: Pick<DooTaskProfile, 'serverUrl' | 'userId'> | null,
    filters: DooTaskFilters,
): string | null {
    if (!profile) return null;
    if (filters.search?.trim()) return null;
    return JSON.stringify([
        profile.serverUrl.replace(/\/+$/, '').toLowerCase(),
        profile.userId,
        filters.status ?? null,
        filters.role ?? null,
        filters.projectId ?? null,
        filters.time ?? null,
    ]);
}
