import { Octokit } from "octokit";
import type { RequestInterface, EndpointOptions } from '@octokit/types';
import { db } from "@/storage/db";
import { decryptString } from "@/modules/encrypt";
import { isGitHubOAuthToken, GitHubReauthorizationRequiredError } from "./githubOAuth";
import { refreshGithubToken } from "./githubTokenRefresh";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function getUserOctokit(userId: string): Promise<Octokit> {
    let token = await getUserGithubToken(userId);
    // Own authentication here so a static auth hook cannot restore the old token on retry.
    const octokit = new Octokit();
    octokit.auth = async () => ({ type: 'token', tokenType: 'oauth', token });
    octokit.hook.wrap('request', async (request: RequestInterface, options: EndpointOptions) => {
        const requestToken = token;
        options.headers = { ...options.headers, authorization: `token ${requestToken}` };
        try {
            return await request(options);
        } catch (error) {
            if ((error as { status?: number }).status !== 401) throw error;
            token = await refreshGithubToken(userId, requestToken);
            options.headers.authorization = `token ${token}`;
            // Retry once, bypassing this hook to avoid an authorization loop.
            return request(options);
        }
    });
    return octokit;
}

export async function getUserGithubToken(userId: string): Promise<string> {
    return (await getUserGithubAuthorization(userId)).token;
}

export async function getUserGithubAuthorization(userId: string): Promise<{ token: string; expiresAt: string | null }> {
    const account = await db.account.findUniqueOrThrow({
        where: { id: userId },
        select: { githubUser: { select: { token: true, expiresAt: true } } }
    });

    if (!account.githubUser?.token) {
        throw new GitHubNotConnectedError();
    }

    const accessToken = decryptString(['user', userId, 'github', 'token'], account.githubUser.token);
    if (!isGitHubOAuthToken(accessToken)) throw new GitHubReauthorizationRequiredError();
    if (account.githubUser.expiresAt && account.githubUser.expiresAt.getTime() <= Date.now() + REFRESH_BUFFER_MS) {
        const token = await refreshGithubToken(userId, accessToken);
        // The old expiration no longer describes this token. Clients revalidate
        // unknown expirations on a short TTL instead of retaining them forever.
        return { token, expiresAt: null };
    }
    return { token: accessToken, expiresAt: account.githubUser.expiresAt?.toISOString() ?? null };
}

export class GitHubNotConnectedError extends Error {
    constructor() {
        super('GitHub account not connected');
        this.name = 'GitHubNotConnectedError';
    }
}
