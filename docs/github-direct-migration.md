# GitHub read migration

## Implemented boundary

- Existing client repository lists/details, Issue/PR lists/details, comments,
  and cross-repository work lists now call api.github.com directly.
- apiGithubData.ts keeps the existing public function names. Direct implementations
  live in happy-app/sources/sync/github/{client,reads,workItems}.ts.
- Mutations and multipart image uploads still call Happy. Successful mutations
  invalidate client read caches without moving the write requests.
- Happy retains OAuth, encrypted credentials, refresh, disconnect, Webhooks,
  and image processing/upload. The 11 old business-data GET routes under
  /v1/github are removed, together with their server-only aggregation/cache code.
  Authorization GET routes under /v1/connect/github are not business-data proxies
  and remain available.

## Authorization contract

GET /v1/connect/github/token returns { token, expiresAt }, with expiresAt nullable.
The added property is backward compatible; the client also accepts older token-only
responses. Both token endpoints set Cache-Control: no-store.

POST /v1/connect/github/token/refresh accepts { previousToken } under Happy Bearer
authentication. It uses the existing per-user refresh coordination, returns the
current token when another request already rotated it, and never returns a
refresh token or client secret. OAuth accounts without refresh credentials require
reauthorization when GitHub rejects their access token.

Client access tokens are memory-only, revalidated at most every 60 seconds and
earlier when the reported expiry requires it. Concurrent acquisition/refresh is
merged. A GitHub 401 triggers at most one refresh and one read retry. Other errors
are not automatically retried; rate-limit errors include retry timing when exposed.
Only fixed GitHub API destinations are accepted; redirects are rejected by the
fetch request options. Native fetch behavior still needs device acceptance testing.

Logout, GitHub connection updates, and server/account changes invalidate sessions.
Session cancellation aborts in-flight transport requests. Hooks discard responses
from superseded filters and refreshes; filter changes do not abort every underlying
shared request. Network operations have a 30-second timeout.

## Pagination and cache

Single-repository Issues use an independent GraphQL Issue connection, avoiding
the previous filter-and-slice pagination omission. PR/comment REST pagination uses
Link headers. Cross-repository scope, updated-time ordering, grouped search and
the GitHub 1000-result-per-query ceiling are preserved.

The client work cache holds repository names for 60 seconds and search pages for
30 seconds, with 100 entries and an approximate 16 MiB serialized-size bound.
Explicit work-list refresh invalidates search pages, not the repository directory.
Work cursors are internal JSON state tied to the complete query list, not the old
server cursor format. They are not persisted or sent to the old read endpoints.

## Deployment and verification

Coordinate the client and server rollout: older clients lose GitHub read access
after removal of the old proxy routes. The new client also needs the new server
for explicit token refresh. Do not deploy this server as a transparent update for
old clients. No database or happy-wire change is needed. No automatic fallback
to the old data proxy is introduced.

Validation on 2026-09-10:
- Selected app tests: 60 passed, including auth, mapping, pagination, stale
  responses, unchanged write/upload routing, and logout/server-config regressions.
- Selected server GitHub tests: 62 passed.
- App yarn typecheck and server yarn build (tsc --noEmit).
- Chromium smoke test bundled the actual new reads.ts/client.ts implementation:
  repository list, public repository details/README/commit count, two distinct
  Issue pages, comments, and PR detail succeeded using one token acquisition.

The browser smoke test used a local authorization bridge backed by the existing
GitHub CLI login, not the deployed Happy OAuth integration. Happy end-to-end
authorization, native devices, and organization/private-access acceptance remain
to be validated. No remote writes or real uploads were performed. Server tests
emit an existing unrelated missing Astro tsconfig warning.

## Real Happy authorization follow-up

The follow-up probe is docs/github-happy-auth-probe.cjs. Unlike the earlier smoke
test, it calls the explicitly selected Happy server from Chromium and obtains
GitHub credentials only through the real Happy token endpoint. It never falls
back to GitHub CLI credentials or a mock authorization bridge.

```bash
NODE_PATH=/tmp/happy-github-probe/node_modules node docs/github-happy-auth-probe.cjs \
  --server http://localhost:3031 --auth-file /path/to/authorized-happy-home/access.key
```

Select credentials belonging to that server. Do not paste tokens into command
arguments or chat. The probe reads only the session token from the credential
file; encryption secrets are not passed into the browser. Output omits tokens,
account IDs, private repository names, and repository contents. It checks one
accessible private repository; empty collections skip item-detail coverage.

Observed on 2026-09-10 against the running development service at localhost:3031:
- Health check: 200.
- Anonymous token access: 401, as expected.
- Existing CLI credentials from both local happy-dev and happy-next homes: 401.
- New refresh endpoint: 404, so the running process has not exposed that route.
- Actual Chromium probe reproduced the authentication and missing-route failures.

Private discovery, repository reads, identity matching, and refresh coordination
have NOT been reached. Update the running server and authorize a session for it
before repeating the probe. No database bypass, credential minting, private
repository reads, GitHub writes, or uploads were performed in this follow-up.

Even a successful probe validates existing-session reuse, not first-time OAuth
consent/callback or real refresh-token rotation. Those require a separate
interactive authorization flow and a controlled expiring credential respectively.
