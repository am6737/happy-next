export const GITHUB_OAUTH_SCOPE = 'read:user,user:email,read:org,repo';

export function isGitHubOAuthToken(token: unknown): token is string {
    // GitHub App user/installation tokens must not be reused for user actions.
    return typeof token === 'string' && token.startsWith('gho_') && token.length > 4;
}

export class GitHubReauthorizationRequiredError extends Error {
    readonly status = 401;

    constructor() {
        super('Reconnect GitHub using the configured OAuth App');
        this.name = 'GitHubReauthorizationRequiredError';
    }
}
