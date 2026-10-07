import { describe, expect, it } from 'vitest';
import { projectLabels } from './projectLabels';

describe('projectLabels', () => {
    it('shows the directory name', () => {
        expect(projectLabels(['~/wwwroot/happy-next', '~/code/api'])).toEqual(new Map([
            ['~/wwwroot/happy-next', { name: 'happy-next' }],
            ['~/code/api', { name: 'api' }],
        ]));
    });

    it('adds as much of the parent directory as tells paths with the same name apart', () => {
        expect(projectLabels(['~/wwwroot/playseed', '/Volumes/Workspace/wwwroot/playseed', '~/a/x/lib', '~/b/x/lib'])).toEqual(new Map([
            ['~/wwwroot/playseed', { name: 'playseed', parent: '~/wwwroot' }],
            ['/Volumes/Workspace/wwwroot/playseed', { name: 'playseed', parent: '…/Workspace/wwwroot' }],
            ['~/a/x/lib', { name: 'lib', parent: '~/a/x' }],
            ['~/b/x/lib', { name: 'lib', parent: '~/b/x' }],
        ]));
    });

    it('keeps the home directory and the root as they are', () => {
        expect(projectLabels(['~', '/', '/opt/app'])).toEqual(new Map([
            ['~', { name: '~' }],
            ['/', { name: '/' }],
            ['/opt/app', { name: 'app' }],
        ]));
    });

    it('shows a parent whole once all of it is needed', () => {
        expect(projectLabels(['~/x/app', '/x/app', '/app'])).toEqual(new Map([
            ['~/x/app', { name: 'app', parent: '~/x' }],
            ['/x/app', { name: 'app', parent: '/x' }],
            ['/app', { name: 'app', parent: '/' }],
        ]));
    });

    it('names a worktree by its repository', () => {
        expect(projectLabels(['~/wwwroot/happy-next', '~/wwwroot/happy-next/.dev/worktree/warm-ocean', '~/code/api/.dev/worktree/feat/login'])).toEqual(new Map([
            ['~/wwwroot/happy-next', { name: 'happy-next' }],
            ['~/wwwroot/happy-next/.dev/worktree/warm-ocean', { name: 'happy-next', worktree: 'warm-ocean' }],
            ['~/code/api/.dev/worktree/feat/login', { name: 'api', worktree: 'feat/login' }],
        ]));
    });

    it('tells apart worktrees with the same name in repositories with the same name', () => {
        expect(projectLabels(['~/a/app/.dev/worktree/fix', '~/b/app/.dev/worktree/fix', '~/b/app/.dev/worktree/other'])).toEqual(new Map([
            ['~/a/app/.dev/worktree/fix', { name: 'app', worktree: 'fix', parent: '~/a' }],
            ['~/b/app/.dev/worktree/fix', { name: 'app', worktree: 'fix', parent: '~/b' }],
            ['~/b/app/.dev/worktree/other', { name: 'app', worktree: 'other' }],
        ]));
    });
});
