// Uses an explicitly selected Happy login and server. Never falls back to gh.
// No tokens, account identifiers, private names, or contents are printed.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { parseArgs } = require('node:util');
const { chromium } = require('playwright');
const { build } = require('../node_modules/esbuild');

async function main() {
    const { values } = parseArgs({ options: {
        server: { type: 'string' }, 'auth-file': { type: 'string' },
    } });
    if (!values.server || !values['auth-file']) throw new Error('arguments');
    const target = new URL(values.server);
    if (target.username || target.password || target.search || target.hash
        || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)))) {
        throw new Error('server');
    }
    const serverUrl = target.toString().replace(/\/$/, '');
    const credentials = JSON.parse(fs.readFileSync(values['auth-file'], 'utf8'));
    if (typeof credentials.token !== 'string' || !credentials.token) throw new Error('credentials');
    const source = path.resolve(__dirname, '../packages/happy-app/sources/sync/github');
    const bundle = await build({
        stdin: { contents: `export * as reads from ${JSON.stringify(`${source}/reads.ts`)};
            export * as client from ${JSON.stringify(`${source}/client.ts`)};`, resolveDir: __dirname },
        bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'HappyGithubProbe',
        logLevel: 'silent',
        plugins: [{ name: 'select-happy-server', setup(build) {
            build.onResolve({ filter: /serverConfig$/ }, () => ({ path: 'config', namespace: 'probe' }));
            build.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({ contents: `export const getServerUrl = () => ${JSON.stringify(serverUrl)};` }));
        } }],
    });
    const local = http.createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.url === '/bundle.js') {
            response.setHeader('Content-Type', 'application/javascript');
            response.end(bundle.outputFiles[0].text);
        } else if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><title>Happy authorization probe</title><script src="/bundle.js"></script>');
        } else { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${local.address().port}`);
        const results = await page.evaluate(async ({ serverUrl, token }) => {
            const results = [];
            const { client, reads } = window.HappyGithubProbe;
            const c = { token, secret: '' };
            const happy = (suffix, init = {}) => fetch(`${serverUrl}${suffix}`, {
                ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
            });
            const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
            const record = (name, pass, detail = {}) => results.push({ name, pass, ...detail });
            try {
                const denied = await happy('/v1/connect/github/token');
                record('unauthenticated-token-access-denied', denied.status === 401, { status: denied.status });
                const route = await happy('/v1/connect/github/token/refresh', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ previousToken: 'non-secret-probe' }),
                });
                record('refresh-route-requires-authentication', route.status === 401, { status: route.status });

                const profileResponse = await happy('/v1/account/profile', { headers });
                record('happy-session-accepted', profileResponse.ok, { status: profileResponse.status });
                if (!profileResponse.ok) return results;
                const profile = await profileResponse.json();
                record('happy-github-connected', !!profile.github);
                if (!profile.github) return results;

                const paramsResponse = await happy('/v1/connect/github/params', { headers });
                const params = await paramsResponse.json();
                const oauth = params.url ? new URL(params.url) : null;
                const scopes = oauth?.searchParams.get('scope')?.split(/[ ,]+/) ?? [];
                record('oauth-start-configuration', paramsResponse.ok && oauth?.origin === 'https://github.com'
                    && !!oauth.searchParams.get('state') && scopes.includes('repo') && scopes.includes('read:org'));

                const session = client.githubSession(c);
                const githubToken = await client.githubToken(session);
                record('happy-issued-github-token', !!githubToken);
                const identity = await client.githubJson(session, '/user');
                record('github-identity-matches-happy-profile', identity.id === profile.github.id);
                if (identity.id !== profile.github.id) return results;

                // A deliberately stale token exercises coordination without
                // intentionally rotating/revoking the current GitHub credential.
                if (route.status === 401) {
                    const refreshed = await happy('/v1/connect/github/token/refresh', {
                        method: 'POST', headers, body: JSON.stringify({ previousToken: 'non-secret-stale-probe' }),
                    });
                    const body = await refreshed.json();
                    record('stale-refresh-returns-current-credential', refreshed.ok && body.token === githubToken,
                        { status: refreshed.status, noStore: refreshed.headers.get('cache-control') === 'no-store',
                            expiryMetadataPresent: Object.hasOwn(body, 'expiresAt') });
                }

                const discovery = await client.githubGraphql(session, `query {
                    viewer { repositories(first: 1, privacy: PRIVATE, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
                        orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { nameWithOwner isPrivate hasIssuesEnabled } } }
                }`);
                const repository = discovery.viewer.repositories.nodes[0];
                record('private-repository-available', !!repository);
                if (!repository) return results;
                const [owner, repo] = repository.nameWithOwner.split('/');
                const detail = await reads.readRepo(c, owner, repo);
                record('private-repository-detail', detail.isPrivate === true && detail.fullName === repository.nameWithOwner);
                const pulls = await reads.readPulls(c, owner, repo, { state: 'all', limit: 1 });
                record('private-pr-list', Array.isArray(pulls.items), { empty: pulls.items.length === 0 });
                if (pulls.items.length) {
                    const pull = await reads.readPull(c, owner, repo, pulls.items[0].number);
                    record('private-pr-detail', pull.number === pulls.items[0].number);
                }
                if (repository.hasIssuesEnabled) {
                    const issues = await reads.readIssues(c, owner, repo, { state: 'all', limit: 1 });
                    record('private-issue-list', Array.isArray(issues.items), { empty: issues.items.length === 0 });
                    if (issues.items.length) {
                        const issue = await reads.readIssue(c, owner, repo, issues.items[0].number);
                        const comments = await reads.readComments(c, owner, repo, issue.number, { limit: 1 });
                        record('private-issue-detail-and-comments', issue.number === issues.items[0].number && Array.isArray(comments.items));
                    }
                    if (issues.nextCursor) {
                        const next = await reads.readIssues(c, owner, repo, { state: 'all', limit: 1, cursor: issues.nextCursor });
                        record('private-issue-pagination', next.items.length > 0 && next.items[0].number !== issues.items[0].number);
                    }
                } else {
                    results.push({ name: 'private-issue-list', skipped: 'issues-disabled' });
                }
                const anonymous = await fetch(`https://api.github.com${reads.repositoryPath(owner, repo)}`, {
                    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
                });
                record('anonymous-private-access-hidden', anonymous.status === 404, { status: anonymous.status });
            } catch (error) {
                results.push({ name: 'probe-error', pass: false, errorType: error.name,
                    ...(typeof error.status === 'number' ? { status: error.status } : {}) });
            } finally {
                client.clearGithubSession();
            }
            return results;
        }, { serverUrl, token: credentials.token });
        console.log(JSON.stringify({ results, limitations: [
            'Existing Happy session reuse; no new OAuth consent/callback.',
            'Stale-token refresh coordination only; no forced expiry or revocation.',
            'Chromium only; empty collections do not validate item details.',
        ] }, null, 2));
        if (results.some((result) => result.pass === false)) process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => local.close(resolve));
    }
}
main().catch(() => { console.error('Probe setup failed; check explicit server, auth-file and Playwright installation.'); process.exitCode = 1; });
