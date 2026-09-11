import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'GitHubListView.tsx'), 'utf8');

describe('GitHub reconnect state wiring', () => {
    test('refreshes repository access and the active work list after authorization', () => {
        expect(source).toMatch(/clearGithubCache\(\);\s*refreshRepos\(\);\s*issueResult\.refresh\(\);\s*pullResult\.refresh\(\);/);
    });

    test('does not show a stale expired connection while the list is loading', () => {
        expect(source).toContain('(tokenExpired || activeResult.tokenExpired) && !isLoading');
        expect(source).toContain('if (isLoading) return <ActivityIndicator');
    });

    test('matches DooTask list loading placement and leaves the title stable', () => {
        const main = readFileSync(join(__dirname, 'MainView.tsx'), 'utf8');
        const dootask = readFileSync(join(__dirname, 'DooTaskListView.tsx'), 'utf8');
        expect(source).toContain('style={{ marginTop: 40 }}');
        expect(dootask).toContain('<ActivityIndicator style={{ marginTop: 40 }} />');
        expect(main).not.toContain('githubLoading');
        expect(source).not.toContain('onLoadingChange');
        expect(main).toContain('<Ionicons name="chevron-down"');
    });

    test('places pull-to-refresh above the list header like sessions and DooTask', () => {
        expect(source.match(/ListHeaderComponent=\{listHeader\}/g)).toHaveLength(2);
        expect(source.match(/refreshing=\{isPullRefreshing\}/g)).toHaveLength(2);
        expect(source.match(/contentInsetAdjustmentBehavior=\{Platform.OS === 'ios' \? 'automatic' : undefined\}/g)).toHaveLength(2);
        expect(source).not.toContain('refreshing={isLoading &&');
        expect(source).toContain('if (isPullRefreshing) return null;');
        expect(source).toContain('await Promise.all([refreshRepos(), workIssues.refresh(), workPulls.refresh()]);');
        expect(source).toContain("activeTab === 'issues' ? issueResult.refresh() : pullResult.refresh(),");
    });

    test('keeps the title row and switch geometry stable across tabs and count loading', () => {
        expect(source).toMatch(/headlineRow: \{[^}]*height: 64,/);
        expect(source).toMatch(/swapPill: \{[^}]*width: 112,[^}]*height: 32,/);
        expect(source).toMatch(/swapPillBadge: \{[^}]*width: 32,[^}]*height: 18,/);
        expect(source).not.toContain("opacity: typeof otherTabCount === 'number'");
        expect(source).toContain('minimumFontScale={0.55}');
        expect(source).toMatch(/listContent: \{[^}]*flexGrow: 1,/);
    });

    test('shows switch count loading, zero and unavailable states in the same badge', () => {
        expect(source).toContain("activeTab === 'issues' ? workPulls.loading : workIssues.loading");
        expect(source).toContain("{otherTabCountLoading && typeof otherTabCount !== 'number' ? (");
        expect(source).toContain("size={Platform.OS === 'ios' ? 'small' : 12}");
        expect(source).toContain("style={Platform.OS === 'ios' ? { transform: [{ scale: 0.6 }] } : undefined}");
        expect(source).toContain("typeof otherTabCount === 'number' ? otherTabCount : '\\u2014'");
        expect(source).toContain('selectedRepoInfo?.openPRsCount : selectedRepoInfo?.openIssuesCount');
    });
});
