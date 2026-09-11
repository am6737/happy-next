import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'GitHubListView.tsx'), 'utf8');

describe('GitHub global count wiring', () => {
    test('forwards explicit refresh through the paginated hook to the API', () => {
        const hook = readFileSync(join(__dirname, '../hooks/useGithubData.ts'), 'utf8');
        const api = readFileSync(join(__dirname, '../sync/apiGithubData.ts'), 'utf8');
        expect(hook).toContain('fetcher(undefined, force)');
        expect(hook).toContain('fetchGithubWorkIssues(credentials, { ...options, cursor, refresh })');
        expect(hook).toContain('fetchGithubWorkPulls(credentials, { ...options, cursor, refresh })');
        expect(api).toContain('readWorkIssues as fetchGithubWorkIssues');
        expect(api).toContain('readWorkPulls as fetchGithubWorkPulls');
    });
    test('loads both global totals before the first tab switch', () => {
        expect(source.match(/enabled: isGlobal,/g)).toHaveLength(2);
        expect(source).not.toContain("enabled: isGlobal && activeTab === 'issues'");
        expect(source).not.toContain("enabled: isGlobal && activeTab === 'pulls'");
        expect(source).toContain("const activeItems = activeTab === 'issues' ? issues : filteredPRs");
        expect(source).toContain("activeItems.length === 0 && (activeTab === 'issues' ? issueResult.loading : pullResult.loading)");
    });

    test('uses server totals and preserves existing counts while refreshing', () => {
        expect(source).toContain('workIssues.totalCount');
        expect(source).toContain('workPulls.totalCount');
        expect(source).toContain("otherTabCountLoading && typeof otherTabCount !== 'number'");
        expect(source).not.toContain('workIssues.error ? undefined : workIssues.totalCount');
        expect(source).not.toContain('workPulls.error ? undefined : workPulls.totalCount');
    });
});
