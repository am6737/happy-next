# GitHub direct client feasibility

Date: 2026-09-10. Scope: feasibility only; no application routing changes.

## Decision

Proceed with direct REST/GraphQL data requests, subject to native-device testing.
Do not remove the Web image-upload proxy: the current Release asset upload host
rejects browser CORS preflight. This is a concrete exception to the proposed
authorization-only server boundary, not a completed three-platform migration.

## Observed results

Environment: Linux, Chromium 153.0.8010.12, a loopback HTTP origin, normal browser
security enabled. Authenticated reads used the existing GitHub CLI OAuth login,
not a Happy-issued token. No credentials or repository contents are printed.

| Probe | Result |
| --- | --- |
| Authenticated REST repository page | 200; one item; Link and rate-limit headers readable |
| REST Issue search | 200; one item; incomplete_results=false |
| GraphQL affiliated repositories and Issue/PR counts | 200; data present; no GraphQL errors |
| Public Release metadata | 200 |
| api.github.com browser preflights | 204; Access-Control-Allow-Origin: * |
| uploads.github.com browser preflight | 400; no Access-Control-Allow-Origin |
| Browser Release upload probe | fetch rejected with TypeError: Failed to fetch |
| Canvas JPEG encoding and Blob URL readback | 1568x784; image/jpeg; 7961 bytes |

The upload probe uses a deliberately invalid token against an existing public
Release. It cannot authorize a write. Browser preflight carries header names,
not the token value, so this identifies a CORS failure before upload authorization.
No Releases, tags, assets, comments, or other remote resources were created.
The image probe verifies Web primitives, not the complete Expo compression flow.

## Native assessment (not executed)

No adb, Android emulator, xcrun, or native test device is available here. A mobile
browser viewport would not validate React Native networking and was not used as
a substitute. iOS and Android remain unverified at runtime.

Installed expo-image-manipulator has Web, iOS, and Android implementations.
Its Web save path uses canvas.toBlob and returns a Blob URL. On native platforms,
expo-file-system File implements Blob and expo/fetch accepts binary bodies.
This provides a plausible native compression/upload implementation without a
new image dependency, but does not prove successful native uploads.

Release uploads need raw binary, not the multipart FormData currently sent to
Happy. Use a platform-appropriate file body, correct MIME type, and let the
network stack set Content-Length. The current Expo fetch implementation buffers
binary bodies, so validate memory use and impose a real output-size bound.
The existing server compression threshold is not itself a guaranteed size cap.

## Remaining acceptance gates

- Test iOS and Android devices using Happy-issued credentials: REST, GraphQL,
  pagination headers, cancellation, expiry, and organization/private access.
- Verify Web production origin and Safari/Firefox, not only local Chromium.
- In an explicitly authorized disposable repository, create a temporary Release,
  upload PNG/JPEG, verify returned URL and image display, then clean up only
  resources created by that test. Never reuse or delete an existing image Release.
- Test private Release asset retrieval/display and redirects separately; a
  browser_download_url does not prove an unauthenticated image renderer can read it.
- Test resizing, rotation/EXIF, transparency, large inputs, MIME and byte lengths
  through the actual Expo implementation on all three platforms.
- Keep Web upload on the existing authenticated, repository-scoped proxy until
  an alternative is proven. Do not use no-cors or disable browser security.
- If retaining a proxy, keep fixed GitHub destinations and existing permission
  checks; do not introduce an arbitrary-URL or arbitrary-token forwarding API.

## Reproduce

From the repository root, with gh already authenticated:

```bash
npm install --prefix /tmp/happy-github-probe playwright --no-package-lock --ignore-scripts
/tmp/happy-github-probe/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/happy-github-probe/node_modules node docs/github-direct-probe.cjs
```

The script starts an ephemeral loopback server and closes it and Chromium on
completion. Dependencies are outside the repository. Exit zero means the core
read probes succeeded, not that upload or all platforms passed. Inspect the
reported preflight results for the upload finding.

Relevant implementation: happy-app/sources/sync/apiGithubData.ts;
happy-server/sources/app/github/githubImageUpload.ts;
happy-server/sources/storage/compressImage.ts.
