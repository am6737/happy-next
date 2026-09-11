// Run with Playwright installed externally; no product dependencies are changed.
// Uses gh credentials for read-only API calls. Upload probes use an invalid token.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const http = require('node:http');

async function main() {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        response.end('<!doctype html><title>GitHub direct API probe</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.enable');
        const preflights = [];
        cdp.on('Network.responseReceived', ({ type, response }) => {
            if (type !== 'Preflight') return;
            const headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]));
            preflights.push({ host: new URL(response.url).host, status: response.status,
                allowOrigin: headers['access-control-allow-origin'] ?? null });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const results = await page.evaluate(async (token) => {
            const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
            async function probe(name, url, options, summarize) {
                try {
                    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
                    const body = await response.json();
                    return { name, status: response.status, ...summarize(response, body) };
                } catch (error) {
                    return { name, error: error.name, message: error.message };
                }
            }
            const output = [];
            output.push(await probe('rest-pagination', 'https://api.github.com/user/repos?per_page=1', { headers },
                (r, body) => ({ items: Array.isArray(body) ? body.length : null,
                    linkReadable: !!r.headers.get('link'), rateLimitReadable: !!r.headers.get('x-ratelimit-remaining') })));
            output.push(await probe('rest-search', 'https://api.github.com/search/issues?q=repo%3Acli%2Fcli+is%3Aissue+is%3Aopen&per_page=1', { headers },
                (_r, body) => ({ items: body.items?.length ?? null, incomplete: body.incomplete_results ?? null })));
            output.push(await probe('graphql', 'https://api.github.com/graphql', {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '{ viewer { repositories(first: 1, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) { nodes { name issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount } } pageInfo { hasNextPage endCursor } } } }' }),
            }, (_r, body) => ({ hasData: !!body.data?.viewer?.repositories, hasErrors: !!body.errors })));
            output.push(await probe('release-read', 'https://api.github.com/repos/cli/cli/releases/latest', { headers },
                (_r, body) => ({ releaseId: body.id ?? null })));
            const releaseId = output.find((result) => result.name === 'release-read').releaseId;
            if (releaseId) {
                output.push(await probe('upload-invalid-token',
                    `https://uploads.github.com/repos/cli/cli/releases/${releaseId}/assets?name=happy-cors-probe.png`, {
                        method: 'POST',
                        headers: { Authorization: 'Bearer deliberately-invalid-cors-probe', 'Content-Type': 'image/png' },
                        body: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
                    }, () => ({})));
            }
            const canvas = document.createElement('canvas');
            canvas.width = 1568;
            canvas.height = 784;
            canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
            const uri = URL.createObjectURL(blob);
            const recovered = await (await fetch(uri)).blob();
            URL.revokeObjectURL(uri);
            output.push({ name: 'web-image-primitives', width: canvas.width, height: canvas.height,
                mimeType: recovered.type, bytes: recovered.size });
            return output;
        }, token);
        console.log(JSON.stringify({ browser: browser.version(), results, preflights }, null, 2));
        if (!results.every((r) => !['rest-pagination', 'rest-search', 'graphql', 'release-read'].includes(r.name) || r.status === 200)
            || results.find((r) => r.name === 'graphql').hasErrors) {
            process.exitCode = 1;
        }
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

main().catch((error) => {
    // Do not print subprocess output, credentials, or request headers.
    console.error(`Probe failed (${error.name})`);
    process.exitCode = 1;
});
