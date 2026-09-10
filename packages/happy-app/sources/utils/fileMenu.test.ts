import { describe, expect, it, vi } from 'vitest';
import { buildFileMenuItems, canMutateFile, canShareFileText } from './fileMenu';

const action = (label: string) => ({ label, onPress: vi.fn() });
const owner = { metadata: null };

describe('file menu ordering', () => {
    it('uses the same order regardless of action insertion order', () => {
        const remove = { ...action('delete'), destructive: true };
        const download = { ...action('download'), disabled: true };
        const items = buildFileMenuItems({
            reload: action('reload'), download, history: action('history'),
            copyFileName: action('name'), share: action('share'), delete: remove,
            edit: action('edit'), copyRelativePath: action('path'),
        });
        expect(items.map(item => item.label)).toEqual(['path', 'name', 'edit', 'history', 'share', 'download', 'reload', 'delete']);
        expect(items[5]).toBe(download);
        expect(items[7]).toBe(remove);
    });
    it('places download immediately before delete when reload is unavailable', () => {
        expect(buildFileMenuItems({
            copyRelativePath: action('path'), copyFileName: action('name'),
            download: action('download'), delete: action('delete'), reload: undefined,
        }).map(item => item.label)).toEqual(['path', 'name', 'download', 'delete']);
    });
    it('keeps download and retry accessible when preview loading fails', () => {
        expect(buildFileMenuItems({
            copyRelativePath: action('path'), copyFileName: action('name'),
            download: action('download'), reload: action('retry'),
            edit: undefined, share: undefined, delete: undefined,
        }).map(item => item.label)).toEqual(['path', 'name', 'download', 'retry']);
    });
});

describe('file mutation visibility', () => {
    it('allows owners and admins to mutate existing worktree files', () => {
        expect(canMutateFile(owner, 'worktree', true)).toBe(true);
        expect(canMutateFile({ ...owner, accessLevel: 'admin' }, 'worktree', true)).toBe(true);
    });
    it.each(['view', 'edit'] as const)('does not expose file writes for shared %s access', (accessLevel) => {
        expect(canMutateFile({ ...owner, accessLevel }, 'worktree', true)).toBe(false);
    });
    it.each(['index', 'commit'] as const)('hides mutations for %s views even for owners and admins', (version) => {
        expect(canMutateFile(owner, version, true)).toBe(false);
        expect(canMutateFile({ ...owner, accessLevel: 'admin' }, version, true)).toBe(false);
    });
    it('hides mutations for absent files, unknown sessions and archived sessions', () => {
        expect(canMutateFile(owner, 'worktree', false)).toBe(false);
        expect(canMutateFile(null, 'worktree', true)).toBe(false);
        expect(canMutateFile({ metadata: { path: '/repo', host: 'test', lifecycleState: 'archived' } }, 'worktree', true)).toBe(false);
    });
});

describe('share content visibility', () => {
    it('requires actual text and platform sharing support', () => {
        expect(canShareFileText('', 'ios', true)).toBe(false);
        expect(canShareFileText('', 'web', true)).toBe(false);
        expect(canShareFileText('source or diff', 'web', false)).toBe(false);
        expect(canShareFileText('source or diff', 'web', true)).toBe(true);
        expect(canShareFileText('source or diff', 'ios', false)).toBe(true);
        expect(canShareFileText('source or diff', 'android', false)).toBe(true);
    });
});
