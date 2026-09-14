import * as React from 'react';
import { GitHubOcticon } from './GitHubOcticon';

interface IssueIconProps {
    size: number;
    color: string;
    state?: 'open' | 'closed';
}

export const IssueIcon = React.memo<IssueIconProps>(({ size, color, state = 'open' }) => {
    return <GitHubOcticon name={state === 'closed' ? 'issue-closed' : 'issue-opened'} size={size} color={color} />;
});
IssueIcon.displayName = 'IssueIcon';
