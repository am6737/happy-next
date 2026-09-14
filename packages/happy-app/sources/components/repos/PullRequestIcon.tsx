import * as React from 'react';
import { GitHubOcticon } from './GitHubOcticon';

export type PullRequestIconState = 'open' | 'closed' | 'merged' | 'draft';

export const PullRequestIcon = React.memo(function PullRequestIcon({
    state = 'open',
    size = 16,
    color,
}: {
    state?: PullRequestIconState;
    size?: number;
    color: string;
}) {
    const iconName = state === 'merged'
        ? 'git-merge'
        : state === 'closed'
            ? 'git-pull-request-closed'
            : state === 'draft'
                ? 'git-pull-request-draft'
                : 'git-pull-request';
    return <GitHubOcticon name={iconName} size={size} color={color} />;
});
PullRequestIcon.displayName = 'PullRequestIcon';

