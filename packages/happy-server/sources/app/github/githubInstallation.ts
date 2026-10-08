import { getUserOctokit } from './githubApi';

export async function findAuthorizedInstallation(accountId: string, repositoryId: bigint): Promise<bigint | null> {
    const octokit = await getUserOctokit(accountId);
    const signal = AbortSignal.timeout(15_000);
    try {
        for (let page = 1; page <= 10; page++) {
            const response = await octokit.request('GET /user/installations', { per_page: 100, page, request: { signal } });
            const installations = response.data.installations;
            for (const installation of installations) {
                for (let repoPage = 1; repoPage <= 10; repoPage++) {
                    const repos = await octokit.request('GET /user/installations/{installation_id}/repositories', {
                        installation_id: installation.id, per_page: 100, page: repoPage, request: { signal },
                    });
                    if (repos.data.repositories.some((repository: { id: number }) => BigInt(repository.id) === repositoryId)) {
                        return BigInt(installation.id);
                    }
                    if (repos.data.repositories.length < 100) break;
                }
            }
            if (installations.length < 100) break;
        }
    } catch {
        // OAuth applications without GitHub App installation access remain unbound.
    }
    return null;
}
