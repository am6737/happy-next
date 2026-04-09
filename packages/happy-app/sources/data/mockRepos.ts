export interface RepoInfo {
    fullName: string;
    name: string;
    owner: string;
    description: string;
    language: string;
    stars: number;
    forks: number;
    watchers: number;
    openIssuesCount: number;
    openPRsCount: number;
    repoSizeKb: number;
    createdAt: string;
    pushedAt: string;
    defaultBranch: string;
    branches: string[];
    updatedAt: string;
    isPrivate: boolean;
    readme: string;
    lastSyncedAt?: string;
    /** Machine ID this repo is bound to (required for code storage) */
    machineId?: string;
    /** Path on the machine where code is stored */
    bindingPath?: string;
}

/** Format lastSyncedAt to a human-readable string */
export function formatSyncTime(lastSyncedAt?: string): string {
    if (!lastSyncedAt) return 'Never synced';
    const now = Date.now();
    const then = new Date(lastSyncedAt).getTime();
    const diffMs = now - then;
    const diffM = Math.floor(diffMs / (1000 * 60));
    if (diffM < 1) return 'Just synced';
    if (diffM < 60) return `${diffM}m ago`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
}

export interface RepoCommit {
    sha: string;
    message: string;
    author: string;
    authorAvatar?: string;
    createdAt: string;
}

export interface RepoContributor {
    login: string;
    avatarUrl: string;
    commitsCount: number;
}

export interface RepoPR {
    number: number;
    title: string;
    author: string;
    createdAt: string;
    mergedAt?: string;
    status: 'open' | 'closed' | 'merged';
    headRefName?: string;
    body?: string;
}

export interface RepoFileContent {
    path: string;
    content: string;
    size: number;
    isBinary: boolean;
}

export interface RepoIssue {
    number: number;
    title: string;
    body: string;
    state: 'open' | 'closed';
    author: string;
    createdAt: string;
    labels: { name: string; color: string }[];
    aiStatus: 'idle' | 'running' | 'completed' | 'failed';
    linkedPR?: number;
    /** AutoPilot current phase: 'analyze' | 'modify' | 'pr' */
    currentPhase?: 'analyze' | 'modify' | 'pr';
    /** AutoPilot progress 0-100 */
    progress?: number;
}

export interface RepoSession {
    id: string;
    title: string;
    status: 'active' | 'completed' | 'failed';
    createdAt: string;
    issueNumber?: number;
    ownerType: 'user' | 'ai'; // Added identity discriminator
    ownerName?: string;
    currentActivity?: string; // What AI is doing right now
}

export interface CloudMachine {
    id: string;
    status: 'running' | 'creating' | 'sleeping' | 'stopped';
    lastActiveAt: string;
    branch: string;
}

export interface AutomationRule {
    enabled: boolean;
    autoPilotNewIssues: boolean;
    triggerLabels: string[];
    scheduleCron: string | null; // cron expression string, e.g. "0 * * * *" (hourly)
    model: string;
    permissionMode: string;
}

// Cron preset options for scheduled Auto Pilot
export const CRON_PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Daily', value: '0 0 * * *' },
    { label: 'Weekly', value: '0 0 * * 0' },
] as const;

export function getCronLabel(cron: string | null): string {
    if (!cron) return 'Disabled';
    const preset = CRON_PRESETS.find((p) => p.value === cron);
    return preset?.label ?? cron;
}

/**
 * Returns a human-readable description of a cron expression.
 * Handles common presets and provides fallback descriptions for custom expressions.
 */
export function describeCron(cron: string): string {
    const preset = CRON_PRESETS.find((p) => p.value === cron);
    if (preset) return preset.label;

    // Parse common cron patterns for custom expressions
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every hour: "0 * * * *"
    if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        if (minute === '0') return 'Every hour';
        return `At minute ${minute} of every hour`;
    }

    // Every N hours: "0 */N * * *"
    if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const interval = hour.slice(2);
        return `Every ${interval} hours`;
    }

    // Daily at specific hour: "0 H * * *"
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return `Daily at ${timeStr}`;
    }

    // Weekly: "0 H * * D" where D is 0-6
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const d = parseInt(dayOfWeek, 10);
        const dayStr = days[d] ?? `Day ${dayOfWeek}`;
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return `Every ${dayStr} at ${timeStr}`;
    }

    return cron;
}

export const MOCK_REPOS: RepoInfo[] = [
    {
        fullName: 'facebook/react',
        name: 'react',
        owner: 'facebook',
        description: 'The library for web and native user interfaces.',
        language: 'JavaScript',
        stars: 215432,
        forks: 44231,
        watchers: 8900,
        openIssuesCount: 1243,
        openPRsCount: 342,
        repoSizeKb: 51200,
        createdAt: '2013-05-24T09:37:00Z',
        pushedAt: '2024-03-21T08:00:00Z',
        defaultBranch: 'main',
        branches: ['main', '17-stable', '18-stable', 'canary', 'experimental'],
        updatedAt: '2024-03-20T10:00:00Z',
        isPrivate: false,
        readme: 'A declarative, efficient, and flexible JavaScript library for building user interfaces.\n\n* Declarative: React makes it painless to create interactive UIs.\n* Component-Based: Build encapsulated components that manage their own state.\n* Learn Once, Write Anywhere: New React features with no sweeping changes.',
        lastSyncedAt: '2024-03-21T08:00:00Z',
    },
    {
        fullName: 'hitosea/happy-next',
        name: 'happy-next',
        owner: 'hitosea',
        description: 'Next-generation AI-powered development platform.',
        language: 'TypeScript',
        stars: 1245,
        forks: 89,
        watchers: 156,
        openIssuesCount: 42,
        openPRsCount: 8,
        repoSizeKb: 3840,
        createdAt: '2024-01-10T12:00:00Z',
        pushedAt: '2024-03-21T14:30:00Z',
        defaultBranch: 'main',
        branches: ['main', 'dev', 'feature/voice', 'feature/mobile'],
        updatedAt: '2024-03-21T15:30:00Z',
        isPrivate: true,
        readme: '# Happy Next\n\nA next-generation AI-powered development platform that brings Claude, Codex, and Gemini to your mobile device. Build, test, and deploy applications directly from your phone or tablet.\n\n## Features\n\n- **End-to-end encrypted sessions** - All your code and conversations are encrypted\n- **Mobile-first design** - Built from the ground up for touch interfaces\n- **Cloud machine support** - Connect to remote machines for heavy workloads\n- **Multi-model support** - Use Claude, Codex, Gemini, or any LLM\n- **Real-time collaboration** - Share sessions with team members\n- **Voice control** - Navigate and code using voice commands\n\n## Installation\n\n```bash\nnpm install happy-next\n# or\nyarn add happy-next\n```\n\n## Getting Started\n\n1. Download the app from the App Store or Play Store\n2. Connect your GitHub account\n3. Add a repository or create a new one\n4. Start coding!\n\n## Architecture\n\nHappy Next consists of three main components:\n\n1. **Mobile Client** - React Native app for iOS and Android\n2. **Backend Server** - Fastify server for API and real-time communication\n3. **Voice Gateway** - LiveKit-based voice processing service\n\n## Security\n\nAll data is encrypted using AES-256-GCM. Session tokens are stored in the secure enclave. Remote machine connections use SSH with key-based authentication.\n\n## License\n\nMIT License - see LICENSE file for details.\n\n## Contributing\n\nContributions are welcome! Please read our contributing guide before submitting PRs.\n\n## Support\n\nFor issues and feature requests, please use GitHub Issues.',
    },
];

export const MOCK_GITHUB_REPOS_TO_ADD: RepoInfo[] = [
    {
        fullName: 'vercel/next.js',
        name: 'next.js',
        owner: 'vercel',
        description: 'The React Framework for the Web.',
        language: 'TypeScript',
        stars: 115000,
        forks: 25000,
        watchers: 12400,
        openIssuesCount: 2400,
        openPRsCount: 890,
        repoSizeKb: 76800,
        createdAt: '2012-10-03T08:33:00Z',
        pushedAt: '2024-03-21T10:00:00Z',
        defaultBranch: 'canary',
        branches: ['canary', 'canary-next', 'release', 'main', 'beta'],
        updatedAt: '2024-03-21T12:00:00Z',
        isPrivate: false,
        readme: '# Next.js\n\nThe React Framework for the Web.',
    },
    {
        fullName: 'facebook/react',
        name: 'react',
        owner: 'facebook',
        description: 'The library for web and native user interfaces.',
        language: 'JavaScript',
        stars: 215432,
        forks: 44231,
        watchers: 8900,
        openIssuesCount: 1243,
        openPRsCount: 342,
        repoSizeKb: 51200,
        createdAt: '2013-05-24T09:37:00Z',
        pushedAt: '2024-03-21T08:00:00Z',
        defaultBranch: 'main',
        branches: ['main', '17-stable', '18-stable', 'canary', 'experimental'],
        updatedAt: '2024-03-20T10:00:00Z',
        isPrivate: false,
        readme: 'A declarative, efficient, and flexible JavaScript library.',
    },
    {
        fullName: 'microsoft/vscode',
        name: 'vscode',
        owner: 'microsoft',
        description: 'Visual Studio Code - Open Source IDE.',
        language: 'TypeScript',
        stars: 156000,
        forks: 28000,
        watchers: 8900,
        openIssuesCount: 8900,
        openPRsCount: 1200,
        repoSizeKb: 95000,
        createdAt: '2015-09-03T10:00:00Z',
        pushedAt: '2024-03-21T09:00:00Z',
        defaultBranch: 'main',
        branches: ['main', 'release', 'insider', 'dev'],
        updatedAt: '2024-03-21T11:00:00Z',
        isPrivate: false,
        readme: 'Visual Studio Code - Open Source IDE built on Electron.',
    },
    {
        fullName: 'torvalds/linux',
        name: 'linux',
        owner: 'torvalds',
        description: 'The Linux kernel source tree.',
        language: 'C',
        stars: 190000,
        forks: 32000,
        watchers: 14200,
        openIssuesCount: 3200,
        openPRsCount: 890,
        repoSizeKb: 1200000,
        createdAt: '2011-09-03T08:00:00Z',
        pushedAt: '2024-03-21T07:00:00Z',
        defaultBranch: 'master',
        branches: ['master', 'sparse', 'tags/v6.8', 'tags/v6.7'],
        updatedAt: '2024-03-21T10:30:00Z',
        isPrivate: false,
        readme: 'The Linux kernel source tree.',
    },
];

const MOCK_ISSUES: Record<string, RepoIssue[]> = {
    'hitosea/happy-next': [
        {
            number: 101,
            title: 'Fix WebSocket reconnection logic in cloud environments',
            body: 'When the container sleeps, the WebSocket connection is lost but the app doesn\'t always reconnect properly.',
            state: 'open',
            author: 'mager',
            createdAt: '2024-03-21T09:00:00Z',
            labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'cloud', color: '0075ca' }],
            aiStatus: 'running',
            currentPhase: 'modify',
            progress: 45,
        },
        {
            number: 102,
            title: 'Implement Dark Mode for Settings Lab',
            body: 'The lab section is currently light mode only. We need to support dark mode for consistency.',
            state: 'open',
            author: 'jason',
            createdAt: '2024-03-20T14:20:00Z',
            labels: [{ name: 'feature', color: 'a2eeef' }],
            aiStatus: 'idle',
        },
        {
            number: 103,
            title: 'Performance: Lazy load images in feed',
            body: 'Images in the feed are loaded eagerly, causing slow initial render. Implement lazy loading with IntersectionObserver.',
            state: 'open',
            author: 'lisa',
            createdAt: '2024-03-19T11:00:00Z',
            labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'performance', color: 'fbca04' }],
            aiStatus: 'running',
            currentPhase: 'analyze',
            progress: 15,
        },
        {
            number: 104,
            title: 'Add TypeScript strict mode to CLI',
            body: 'Enable strict mode in tsconfig.json for the CLI package to catch more type errors at compile time.',
            state: 'open',
            author: 'hitosea',
            createdAt: '2024-03-18T16:30:00Z',
            labels: [{ name: 'refactor', color: 'fef2c0' }, { name: 'typescript', color: '3178c6' }],
            aiStatus: 'completed',
        },
        {
            number: 105,
            title: 'Write API documentation for /sessions endpoint',
            body: 'Add OpenAPI spec and usage examples for the new /sessions REST endpoint.',
            state: 'open',
            author: 'mager',
            createdAt: '2024-03-18T09:15:00Z',
            labels: [{ name: 'documentation', color: '0075ca' }],
            aiStatus: 'idle',
        },
        {
            number: 106,
            title: 'Optimize bundle size by tree-shaking unused modules',
            body: 'Several large dependencies are included in the bundle even though only small parts are used. Analyze with webpack-bundle-analyzer.',
            state: 'open',
            author: 'jason',
            createdAt: '2024-03-17T14:00:00Z',
            labels: [{ name: 'optimization', color: '00b140' }],
            aiStatus: 'running',
        },
        {
            number: 107,
            title: 'Add unit tests for auth flow',
            body: 'Cover the OAuth handshake, token refresh, and session persistence with Vitest unit tests.',
            state: 'open',
            author: 'lisa',
            createdAt: '2024-03-16T10:00:00Z',
            labels: [{ name: 'testing', color: '00b140' }],
            aiStatus: 'completed',
        },
        {
            number: 108,
            title: 'CI: Add E2E test workflow',
            body: 'Set up Playwright-based E2E tests in GitHub Actions, triggered on every PR to main.',
            state: 'open',
            author: 'hitosea',
            createdAt: '2024-03-15T08:45:00Z',
            labels: [{ name: 'ci', color: '00b140' }, { name: 'testing', color: '00b140' }],
            aiStatus: 'idle',
        },
        {
            number: 109,
            title: 'Refactor storage abstraction layer',
            body: 'The current storage utility mixes concerns. Extract a clean repository interface for future testability.',
            state: 'open',
            author: 'mager',
            createdAt: '2024-03-14T15:30:00Z',
            labels: [{ name: 'refactor', color: 'fef2c0' }],
            aiStatus: 'failed',
        },
        {
            number: 110,
            title: 'Add dark mode support to onboarding',
            body: 'The onboarding flow ignores system appearance settings and always renders in light mode.',
            state: 'open',
            author: 'jason',
            createdAt: '2024-03-13T12:00:00Z',
            labels: [{ name: 'feature', color: 'a2eeef' }],
            aiStatus: 'completed',
        },
    ],
};

const MOCK_SESSIONS: Record<string, RepoSession[]> = {
    'hitosea/happy-next': [
        {
            id: 'sess-1',
            title: 'WebSocket reconnection logic',
            status: 'active',
            createdAt: '2024-03-21T10:15:00Z',
            issueNumber: 101,
            ownerType: 'ai',
            ownerName: 'Happy Agent',
            currentActivity: 'Running npm test --grep reconnection',
        },
        {
            id: 'sess-2',
            title: 'Manual UI Polish',
            status: 'active',
            createdAt: '2024-03-21T11:00:00Z',
            ownerType: 'user',
            ownerName: 'mager',
        },
        {
            id: 'sess-3',
            title: 'Memory leak in RealtimeSession',
            status: 'completed',
            createdAt: '2024-03-19T16:45:00Z',
            ownerType: 'ai',
            ownerName: 'Happy Agent',
        },
    ],
};

const MOCK_AUTOMATION_RULES: Record<string, AutomationRule> = {
    'hitosea/happy-next': {
        enabled: true,
        autoPilotNewIssues: true,
        triggerLabels: ['bug', 'critical'],
        scheduleCron: '0 */6 * * *', // every 6 hours
        model: 'Claude 3.5 Sonnet',
        permissionMode: 'Plan before executing',
    },
};

export function getIssuesForRepo(fullName: string): RepoIssue[] {
    return MOCK_ISSUES[fullName] || [];
}

export function createIssue(
    fullName: string,
    issue: Omit<RepoIssue, 'createdAt' | 'aiStatus' | 'state'>
): RepoIssue {
    const newIssue: RepoIssue = {
        ...issue,
        state: 'open',
        createdAt: new Date().toISOString(),
        aiStatus: 'idle',
    };
    if (!MOCK_ISSUES[fullName]) {
        MOCK_ISSUES[fullName] = [];
    }
    MOCK_ISSUES[fullName] = [...MOCK_ISSUES[fullName], newIssue];
    return newIssue;
}

export function getSessionsForRepo(fullName: string): RepoSession[] {
    return MOCK_SESSIONS[fullName] || [];
}

/**
 * Update an issue's AutoPilot progress and phase.
 */
export function updateIssueAutoPilotProgress(
    fullName: string,
    issueNumber: number,
    update: { progress?: number; currentPhase?: 'analyze' | 'modify' | 'pr'; aiStatus?: RepoIssue['aiStatus'] }
): void {
    const issues = MOCK_ISSUES[fullName];
    if (!issues) return;

    const index = issues.findIndex((i) => i.number === issueNumber);
    if (index === -1) return;

    const issue = issues[index];
    if (update.progress !== undefined) issue.progress = update.progress;
    if (update.currentPhase !== undefined) issue.currentPhase = update.currentPhase;
    if (update.aiStatus !== undefined) issue.aiStatus = update.aiStatus;
}

/**
 * Get a single issue by repo and issue number.
 */
export function getIssueByNumber(fullName: string, issueNumber: number): RepoIssue | undefined {
    return MOCK_ISSUES[fullName]?.find((i) => i.number === issueNumber);
}

const MOCK_COMMITS: Record<string, RepoCommit[]> = {
    'hitosea/happy-next': [
        { sha: 'a1b2c3d', message: 'fix(github): resolve OAuth state error on repeated auth', author: 'hitosea', createdAt: '2024-03-21T10:00:00Z' },
        { sha: 'e4f5g6h', message: 'fix(server): race condition in shutdown handler', author: 'mager', createdAt: '2024-03-20T15:30:00Z' },
        { sha: 'i7j8k9l', message: 'fix(github): handle OAuth configuration errors', author: 'hitosea', createdAt: '2024-03-20T11:00:00Z' },
        { sha: 'm0n1o2p', message: 'fix(dev): crash in dev screen without encryption init', author: 'jason', createdAt: '2024-03-19T09:45:00Z' },
        { sha: 'q3r4s5t', message: 'chore: add worktree isolation to gitignore', author: 'hitosea', createdAt: '2024-03-18T14:20:00Z' },
    ],
    'facebook/react': [
        { sha: 'abc1234', message: 'React 19 RC.1 release', author: 'acdlite', createdAt: '2024-03-20T18:00:00Z' },
        { sha: 'def5678', message: 'compiler: fold type predicates into filter boolean logic', author: 'rickmill', createdAt: '2024-03-19T12:00:00Z' },
        { sha: 'ghi9012', message: 'useActionState: fix pending tracking on CSP violation', author: 'thetry', createdAt: '2024-03-18T09:30:00Z' },
        { sha: 'jkl3456', message: 'Flight: enable server components in resource loads', author: 'sebmarkbage', createdAt: '2024-03-17T16:00:00Z' },
        { sha: 'mno7890', message: 'DevTools: show slot in owner tree', author: 'bvaughn', createdAt: '2024-03-16T11:00:00Z' },
    ],
};

const MOCK_CONTRIBUTORS: Record<string, RepoContributor[]> = {
    'hitosea/happy-next': [
        { login: 'hitosea', avatarUrl: 'https://avatars.githubusercontent.com/u/1234567', commitsCount: 142 },
        { login: 'mager', avatarUrl: 'https://avatars.githubusercontent.com/u/2345678', commitsCount: 87 },
        { login: 'jason', avatarUrl: 'https://avatars.githubusercontent.com/u/3456789', commitsCount: 34 },
        { login: 'lisa', avatarUrl: 'https://avatars.githubusercontent.com/u/4567890', commitsCount: 21 },
    ],
    'facebook/react': [
        { login: 'acdlite', avatarUrl: 'https://avatars.githubusercontent.com/u/1', commitsCount: 1203 },
        { login: 'sebmarkbage', avatarUrl: 'https://avatars.githubusercontent.com/u/2', commitsCount: 987 },
        { login: 'bvaughn', avatarUrl: 'https://avatars.githubusercontent.com/u/3', commitsCount: 654 },
        { login: 'gaearon', avatarUrl: 'https://avatars.githubusercontent.com/u/4', commitsCount: 432 },
        { login: 'rickmill', avatarUrl: 'https://avatars.githubusercontent.com/u/5', commitsCount: 298 },
    ],
};

const MOCK_PRS: Record<string, RepoPR[]> = {
    'hitosea/happy-next': [
        { number: 46, title: 'feat: add repository search with fuzzy matching', author: 'jason', createdAt: '2024-03-21T09:00:00Z', status: 'open', headRefName: 'feature/search' },
        { number: 45, title: 'feat: add session sharing with friends', author: 'mager', createdAt: '2024-03-18T14:00:00Z', mergedAt: '2024-03-20T16:00:00Z', status: 'merged', headRefName: 'feat/session-sharing' },
        { number: 44, title: 'fix: resolve WebSocket reconnect logic', author: 'hitosea', createdAt: '2024-03-17T10:00:00Z', mergedAt: '2024-03-19T11:30:00Z', status: 'merged', headRefName: 'fix/websocket' },
        { number: 43, title: 'chore: update dependencies', author: 'jason', createdAt: '2024-03-15T08:00:00Z', mergedAt: '2024-03-18T09:00:00Z', status: 'merged', headRefName: 'chore/deps' },
        { number: 42, title: 'refactor: extract storage repository interface', author: 'mager', createdAt: '2024-03-14T11:00:00Z', status: 'closed' },
    ],
    'facebook/react': [
        { number: 29383, title: 'React 19 RC', author: 'acdlite', createdAt: '2024-03-18T12:00:00Z', mergedAt: '2024-03-20T18:00:00Z', status: 'merged', headRefName: 'main' },
        { number: 29345, title: 'compiler: fold type predicates into filter boolean', author: 'rickmill', createdAt: '2024-03-17T09:00:00Z', mergedAt: '2024-03-19T12:00:00Z', status: 'merged', headRefName: 'pr/29345' },
        { number: 29322, title: 'useActionState: fix pending tracking on CSP', author: 'thetry', createdAt: '2024-03-16T14:00:00Z', mergedAt: '2024-03-18T09:30:00Z', status: 'merged', headRefName: 'pr/29322' },
    ],
};

export function getCommitsForRepo(fullName: string): RepoCommit[] {
    return MOCK_COMMITS[fullName] || [];
}

export function getContributorsForRepo(fullName: string): RepoContributor[] {
    return MOCK_CONTRIBUTORS[fullName] || [];
}

export function getPRsForRepo(fullName: string): RepoPR[] {
    return MOCK_PRS[fullName] || [];
}

// ---------------------------------------------------------------------------
// Mock file content for code browser
// ---------------------------------------------------------------------------

const MOCK_FILE_CONTENT: Record<string, string> = {
    'README.md': `# Happy Next

A next-generation AI-powered development platform.

## Features

- **AI-Powered Development** — Let AI handle routine fixes while you focus on architecture
- **Cloud Machines** — Development environments that run 24/7 in the cloud
- **End-to-End Encrypted** — Your code never touches our servers unencrypted

## Quick Start

\`\`\`bash
npm install -g happy-next
happy login
happy init
\`\`\`

## Architecture

The platform consists of:

- \`happy-app\` — Mobile & web client (React Native + Expo)
- \`happy-server\` — Backend API (Fastify + Socket.IO)
- \`happy-cli\` — CLI wrapper for Claude Code, Codex, and Gemini
- \`happy-voice\` — LiveKit-based voice gateway
- \`happy-wire\` — Shared Zod schemas

## License

MIT`,
    'package.json': `{
  "name": "happy-next",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^1.13.0",
    "typescript": "^5.4.0"
  }
}`,
    'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules"]
}`,
    '.gitignore': `# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
dist/
build/
.turbo/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db`,
    'src/index.ts': `export { createApp } from './app';

const app = createApp();

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});`,
    'src/App.tsx': `import * as React from 'react';
import { View, Text } from 'react-native';

interface AppProps {
  title?: string;
}

export function App({ title = 'Happy Next' }: AppProps): React.JSX.Element {
  const [count, setCount] = React.useState(0);

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{title}</Text>
      <Text style={{ marginTop: 8 }}>Count: {count}</Text>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </View>
  );
}`,
    'src/components/Button.tsx': `import * as React from 'react';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: ButtonProps): React.JSX.Element {
  const colors = {
    primary: { bg: '#007AFF', text: '#fff' },
    secondary: { bg: '#E5E5EA', text: '#000' },
    danger: { bg: '#FF3B30', text: '#fff' },
  };

  const { bg, text } = colors[variant];

  return (
    <button
      onClick={onPress}
      disabled={disabled}
      style={{
        backgroundColor: disabled ? '#C7C7CC' : bg,
        color: text,
        padding: '10px 20px',
        borderRadius: 8,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}`,
    'src/components/Input.tsx': `import * as React from 'react';

export interface InputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

export function Input({
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  autoCapitalize = 'none',
}: InputProps): React.JSX.Element {
  return (
    <input
      type={secureTextEntry ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      placeholder={placeholder}
      autoCapitalize={autoCapitalize}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid #C7C7CC',
        fontSize: 16,
      }}
    />
  );
}`,
    'src/components/Modal.tsx': `import * as React from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ visible, onClose, title, children }: ModalProps): React.JSX.Element | null {
  if (!visible) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          padding: 20,
          minWidth: 300,
          maxWidth: '90vw',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}`,
    'src/hooks/useAuth.ts': `import * as React from 'react';

interface AuthState {
  token: string | null;
  user: { id: string; name: string; email: string } | null;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState & {
  login: (token: string) => void;
  logout: () => void;
} {
  const [state, setState] = React.useState<AuthState>({
    token: null,
    user: null,
    isAuthenticated: false,
  });

  const login = React.useCallback((token: string) => {
    // In real app, decode JWT and fetch user profile
    const user = { id: '1', name: 'Demo User', email: 'demo@happy.dev' };
    setState({ token, user, isAuthenticated: true });
  }, []);

  const logout = React.useCallback(() => {
    setState({ token: null, user: null, isAuthenticated: false });
  }, []);

  return { ...state, login, logout };
}`,
    'src/hooks/useTheme.ts': `import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContext {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContext | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [theme, setTheme] = React.useState<Theme>('system');

  const resolvedTheme = React.useMemo(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContext {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}`,
    'src/utils/format.ts': `/**
 * Format a number with thousands separators
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return \`\${bytes} B\`;
  if (bytes < 1024 * 1024) return \`\${(bytes / 1024).toFixed(1)} KB\`;
  if (bytes < 1024 * 1024 * 1024) return \`\${(bytes / (1024 * 1024)).toFixed(1)} MB\`;
  return \`\${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB\`;
}

/**
 * Format a date to relative time string
 */
export function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return \`\${diffMin}m ago\`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return \`\${diffH}h ago\`;
  const diffD = Math.floor(diffH / 24);
  return \`\${diffD}d ago\`;
}`,
    'src/utils/validate.ts': `/**
 * Validate a GitHub repository URL
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https?:\\/\\/github\\.com\\/([^/]+)\\/([^/\\s]+)\\/?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\\.git$/, '') };
}

/**
 * Validate an email address
 */
export function isValidEmail(email: string): boolean {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}

/**
 * Validate a cron expression (basic check)
 */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\\s+/);
  if (parts.length !== 5) return false;
  return parts.every(part => /^[*\\-\\/,\\d]+$/.test(part));
}`,
    'docs/API.md': `# API Reference

## Authentication

All API requests require a Bearer token:

\`\`\`
Authorization: Bearer <your-token>
\`\`\`

## Endpoints

### GET /api/repos

List all repositories for the authenticated user.

**Response:**
\`\`\`json
{
  "repos": [
    { "id": "1", "fullName": "owner/repo", "language": "TypeScript" }
  ]
}
\`\`\`

### GET /api/repos/:owner/:repo

Get details for a specific repository.

### POST /api/repos

Create a new repository.

### DELETE /api/repos/:owner/:repo

Delete a repository.

## Webhooks

Happy Next sends webhook events for:

- \`repo.created\` — When a new repo is added
- \`session.started\` — When a dev session begins
- \`session.ended\` — When a dev session ends
- \`ai.fix.completed\` — When Auto Pilot finishes fixing an issue`,
    'docs/CHANGELOG.md': `# Changelog

## [1.0.0] - 2024-03-21

### Added
- Initial release of Happy Next platform
- Repositories management with GitHub sync
- AI-powered issue fixing (Auto Pilot)
- Cloud machine support
- End-to-end encrypted sessions

### Features
- Mobile app (iOS & Android)
- Web dashboard
- CLI tool
- Voice commands`,
    'packages/happy-app/package.json': `{
  "name": "@happy-dev/happy-app",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.ts",
  "dependencies": {
    "expo": "~51.0.0",
    "expo-router": "~3.5.0",
    "react-native": "0.74.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "typescript": "^5.4.0"
  }
}`,
};

export function getFileContent(path: string): string | null {
    return MOCK_FILE_CONTENT[path] ?? null;
}

export function getAutomationRule(fullName: string): AutomationRule {
    return MOCK_AUTOMATION_RULES[fullName] || {
        enabled: false,
        autoPilotNewIssues: false,
        triggerLabels: [],
        scheduleCron: null,
        model: 'GPT-4o',
        permissionMode: 'Default',
    };
}

// ---------------------------------------------------------------------------
// Shared creating repo state — connects add.tsx → repos/index.tsx
// Module-level so it survives navigation between the two screens
// ---------------------------------------------------------------------------
let _pendingCreatingRepo: RepoInfo | null = null;
let _pendingCreatingListeners: Array<(repo: RepoInfo | null) => void> = [];
let _batchListeners: Array<(repos: RepoInfo[]) => void> = [];

export function setPendingCreatingRepo(repo: RepoInfo | null): void {
    _pendingCreatingRepo = repo;
    _pendingCreatingListeners.forEach((fn) => fn(repo));
}

export function getPendingCreatingRepo(): RepoInfo | null {
    return _pendingCreatingRepo;
}

export function subscribeCreatingRepo(fn: (repo: RepoInfo | null) => void): () => void {
    _pendingCreatingListeners.push(fn);
    return () => {
        _pendingCreatingListeners = _pendingCreatingListeners.filter((l) => l !== fn);
    };
}

/** Subscribe to batch add events (multiple repos added at once) */
export function subscribeCreatingBatch(fn: (repos: RepoInfo[]) => void): () => void {
    _batchListeners.push(fn);
    return () => {
        _batchListeners = _batchListeners.filter((l) => l !== fn);
    };
}

/**
 * Add multiple repos at once. Fires the batch event immediately so all repos
 * appear in the list at once; individual repo subscribers are NOT called.
 */
export function setPendingCreatingBatch(repos: RepoInfo[]): void {
    if (repos.length === 0) return;
    _batchListeners.forEach((fn) => fn(repos));
}

// ---------------------------------------------------------------------------
// Mock state helpers — manage local component state, not a global store
// ---------------------------------------------------------------------------

/** Parse a GitHub URL to extract owner/repo, or null if invalid */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+)\/?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/** Parse a GitLab URL to extract owner/repo, or null if invalid */
export function parseGitLabUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/\s]+)\/?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/** Parse a generic git URL (SSH like git@host:owner/repo.git or other git URLs) */
export function parseGenericGitUrl(url: string): { owner: string; repo: string } | null {
    // Try SSH format: git@host:owner/repo.git or git@host:owner/repo
    const sshMatch = url.match(/^git@[^:]+:([^/]+)\/([^/\s]+)\/?$/);
    if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/, '') };
    }
    // Try HTTPS/HTTP format with .git suffix: https://host/owner/repo.git
    const httpsMatch = url.match(/^https?:\/\/[^\/]+\/([^/]+)\/([^/\s]+)\.git\/?$/);
    if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
    // Try another HTTPS format: https://host/owner/repo
    const httpsPlainMatch = url.match(/^https?:\/\/[^\/]+\/([^/]+)\/([^/\s]+)\/?$/);
    if (httpsPlainMatch) {
        return { owner: httpsPlainMatch[1], repo: httpsPlainMatch[2].replace(/\.git$/, '') };
    }
    return null;
}

/** Step labels and weight boundaries for the "Creating" progress bar */
export const CREATING_STEPS = [
    { label: 'Pulling Docker Image…', minWeight: 0, maxWeight: 33 },
    { label: 'Cloning Repository…', minWeight: 33, maxWeight: 66 },
    { label: 'Starting Happy Container…', minWeight: 66, maxWeight: 100 },
] as const;

/** Given a progress 0-100, returns the current creating step label */
export function getCreatingStepLabel(progress: number): string {
    for (const step of CREATING_STEPS) {
        if (progress <= step.maxWeight) return step.label;
    }
    return CREATING_STEPS[CREATING_STEPS.length - 1].label;
}

/** Activity messages shown while AI is working */
export const AI_ACTIVITIES = [
    'Analyzing repository structure…',
    'Searching for relevant code patterns…',
    'Generating implementation plan…',
    'Applying code changes…',
    'Running tests…',
    'Verifying changes…',
    'Creating Pull Request…',
];

/** Machine statuses and their colors */
export const CLOUD_STATUS_CONFIG: Record<CloudMachine['status'], { color: string; label: string }> = {
    running: { color: '#34C759', label: 'Running' },
    creating: { color: '#FF9500', label: 'Creating…' },
    sleeping: { color: '#AF52DE', label: 'Sleeping' },
    stopped: { color: '#8E8E93', label: 'Stopped' },
};

/** Machine statuses that count as "online" for CloudMachine */
export const ONLINE_CLOUD_MACHINE_STATUSES: CloudMachine['status'][] = ['running', 'creating', 'sleeping'];

export function isCloudMachineOnline(machine: CloudMachine): boolean {
    return ONLINE_CLOUD_MACHINE_STATUSES.includes(machine.status);
}

// ---------------------------------------------------------------------------
// Mock Lab Machines — separate from the real Machine storage
// These are cloud machines managed by the happy-agent container
// ---------------------------------------------------------------------------

export type MockLabMachineType = 'local' | 'cloud';
export type MockLabMachineStatus = 'online' | 'offline' | 'creating' | 'connecting';

export interface MockLabMachine {
    id: string;
    type: MockLabMachineType;
    name: string;
    host: string;
    status: MockLabMachineStatus;
    createdAt: string;
    lastSeen: string;
    /** Current creating progress 0-100, only valid when status === 'creating' */
    creatingProgress: number;
    /** Which registration method was used */
    registeredVia: 'qr' | 'docker' | 'manual' | 'server';
}

const MOCK_LAB_MACHINES: MockLabMachine[] = [
    {
        id: 'lab-mach-1',
        type: 'cloud',
        name: 'My Cloud Server',
        host: 'cloud.example.com:3000',
        status: 'online',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        lastSeen: new Date().toISOString(),
        creatingProgress: 100,
        registeredVia: 'docker',
    },
    {
        id: 'lab-mach-2',
        type: 'cloud',
        name: 'Docker Desktop Agent',
        host: 'localhost:3001',
        status: 'online',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        lastSeen: new Date().toISOString(),
        creatingProgress: 100,
        registeredVia: 'docker',
    },
];

// ---------------------------------------------------------------------------
// Mock Lab Machine state management
// ---------------------------------------------------------------------------
type MachineListener = (machines: MockLabMachine[]) => void;
let _mockLabMachines: MockLabMachine[] = [...MOCK_LAB_MACHINES];
let _machineListeners: MachineListener[] = [];

function _notifyMachineListeners(): void {
    _machineListeners.forEach((fn) => fn([..._mockLabMachines]));
}

export function getMockLabMachines(): MockLabMachine[] {
    return [..._mockLabMachines];
}

export function subscribeMockLabMachines(fn: MachineListener): () => void {
    _machineListeners.push(fn);
    return () => {
        _machineListeners = _machineListeners.filter((l) => l !== fn);
    };
}

export function getMockLabMachine(id: string): MockLabMachine | undefined {
    return _mockLabMachines.find((m) => m.id === id);
}

export function addMockLabMachine(machine: MockLabMachine): void {
    _mockLabMachines = [..._mockLabMachines, machine];
    _notifyMachineListeners();
}

export function updateMockLabMachine(id: string, updates: Partial<MockLabMachine>): void {
    _mockLabMachines = _mockLabMachines.map((m) => (m.id === id ? { ...m, ...updates } : m));
    _notifyMachineListeners();
}

export function removeMockLabMachine(id: string): void {
    _mockLabMachines = _mockLabMachines.filter((m) => m.id !== id);
    _notifyMachineListeners();
}

export function generateDockerCommand(machineId: string): string {
    return `docker run -e HAPPY_MACHINE_ID=${machineId} -p 3000:3000 happy-agent`;
}

export const MACHINE_TYPE_CONFIG: Record<MockLabMachineType, { label: string; color: string }> = {
    local: { label: 'Local', color: '#34C759' },
    cloud: { label: 'Cloud', color: '#5AC8FA' },
};

export const MACHINE_STATUS_CONFIG: Record<MockLabMachineStatus, { color: string; label: string }> = {
    online: { color: '#34C759', label: 'Online' },
    offline: { color: '#8E8E93', label: 'Offline' },
    creating: { color: '#FF9500', label: 'Creating…' },
    connecting: { color: '#FF9500', label: 'Connecting…' },
};

export const ONLINE_MACHINE_STATUSES: MockLabMachineStatus[] = ['online', 'creating', 'connecting'];

export function isMockLabMachineOnline(machine: MockLabMachine): boolean {
    return ONLINE_MACHINE_STATUSES.includes(machine.status);
}
