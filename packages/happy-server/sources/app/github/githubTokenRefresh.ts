import { db } from '@/storage/db';
import { encryptString, decryptString } from '@/modules/encrypt';
import { isGitHubOAuthToken, GitHubReauthorizationRequiredError } from './githubOAuth';

const inflightRefreshes = new Map<string, Promise<string>>();

export async function refreshGithubToken(userId: string, previousToken: string): Promise<string> {
    const existing = inflightRefreshes.get(userId);
    if (existing) return existing;
    const promise = doRefresh(userId, previousToken);
    inflightRefreshes.set(userId, promise);
    try {
        return await promise;
    } finally {
        inflightRefreshes.delete(userId);
    }
}

async function doRefresh(userId: string, previousToken: string): Promise<string> {
    const account = await db.account.findUniqueOrThrow({
        where: { id: userId },
        select: { githubUser: { select: { id: true, token: true, refreshToken: true } } },
    });
    const github = account.githubUser;
    if (!github?.token) throw new GitHubReauthorizationRequiredError();
    const currentToken = decryptString(['user', userId, 'github', 'token'], github.token);
    if (!isGitHubOAuthToken(currentToken)) throw new GitHubReauthorizationRequiredError();
    // Another request may already have refreshed the token that received a 401.
    if (currentToken !== previousToken) return currentToken;
    if (!github.refreshToken) throw new GitHubReauthorizationRequiredError();

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('GitHub OAuth not configured');
    const refreshToken = decryptString(['user', userId, 'github', 'refreshToken'], github.refreshToken);
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: clientId, client_secret: clientSecret,
            grant_type: 'refresh_token', refresh_token: refreshToken,
        }),
    });
    if (response.status >= 500 || response.status === 429) {
        throw new Error('GitHub token refresh temporarily unavailable');
    }
    const data = await response.json() as {
        access_token?: string; refresh_token?: string; expires_in?: number; error?: string;
    };
    if (!response.ok || data.error || !isGitHubOAuthToken(data.access_token)) {
        throw new GitHubReauthorizationRequiredError();
    }
    const expiresAt = data.expires_in && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? new Date(Date.now() + data.expires_in * 1000) : null;
    // Do not overwrite credentials replaced by a reconnect/disconnect during the exchange.
    const result = await db.githubUser.updateMany({
        where: { id: github.id, token: github.token, Account: { some: { id: userId } } },
        data: {
            token: encryptString(['user', userId, 'github', 'token'], data.access_token),
            refreshToken: data.refresh_token
                ? encryptString(['user', userId, 'github', 'refreshToken'], data.refresh_token)
                : github.refreshToken,
            expiresAt,
        },
    });
    if (result.count !== 1) throw new GitHubReauthorizationRequiredError();
    return data.access_token;
}
