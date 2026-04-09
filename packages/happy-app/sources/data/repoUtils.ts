import type { RepoIssue, RepoPR } from './mockRepos';

export type IssueFilter = 'all' | 'open' | 'ai-running' | 'ai-done';
export type PRFilter = 'all' | 'open' | 'merged' | 'closed';

export const ISSUE_FILTERS: Array<{ key: IssueFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'ai-running', label: 'Auto Pilot On' },
    { key: 'ai-done', label: 'Auto Pilot Done' },
];

export const PR_FILTERS: Array<{ key: PRFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'merged', label: 'Merged' },
    { key: 'closed', label: 'Closed' },
];

export const LANGUAGE_COLORS: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Shell: '#89e051',
    MDX: '#fcb32c',
};

export const AI_STATUS_COLORS: Record<string, string> = {
    idle: '#8E8E93',
    running: '#007AFF',
    completed: '#34C759',
    failed: '#FF3B30',
};

export const AI_STATUS_LABELS: Record<string, string> = {
    idle: 'Ready',
    running: 'Auto Pilot On',
    completed: 'Auto Pilot Done',
    failed: 'Auto Pilot Failed',
};

export function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return `${Math.floor(diffD / 30)}mo ago`;
}

export function formatBytes(kb: number): string {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatNumber(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

export function filterIssues(issues: RepoIssue[], filter: IssueFilter): RepoIssue[] {
    switch (filter) {
        case 'open': return issues.filter((i) => i.state === 'open');
        case 'ai-running': return issues.filter((i) => i.aiStatus === 'running');
        case 'ai-done': return issues.filter((i) => i.aiStatus === 'completed');
        default: return issues;
    }
}

export function filterPRs(pulls: RepoPR[], filter: PRFilter): RepoPR[] {
    switch (filter) {
        case 'open': return pulls.filter((p) => p.status === 'open');
        case 'merged': return pulls.filter((p) => p.status === 'merged');
        case 'closed': return pulls.filter((p) => p.status === 'closed');
        default: return pulls;
    }
}
