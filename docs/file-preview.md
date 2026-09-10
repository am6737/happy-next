# File Previews and Downloads

The session file viewer supports SVG, HTML/HTM, Markdown (MD/Markdown), PDF,
and the existing PNG/JPEG/GIF/WebP formats. The app and CLI must both include
the versioned preview RPCs. Shared sessions also require the updated server
read-only RPC allowlist. An older/offline CLI produces a retryable error;
the app does not silently fall back to reading a different version.

Downloading is independent of preview support. Every ordinary file (including
code, archives, fonts, extensionless files and arbitrary binary formats) can be
downloaded up to and including 100 MiB. Directory archives are not supported.
Both app and CLI need the download RPCs; shared sessions need the server update.

## Versions and Views

- Browsing defaults to previewing the working tree.
- Status entries pass `view=diff`. Textual formats default to their diff when
  present, with Preview / Source / Diff tabs. Binary formats have no text diff.
- Staged entries read the index, not the working tree. Commit entries read an
  immutable Git blob, comparing against the first parent (or the empty tree
  for an initial commit).
- Deleted entries explicitly identify the previous version being displayed.
  Renames resolve the corresponding old/new path. Failed reads never substitute
  current working-tree content for historical/index content.
- Editing is available only for existing working-tree text. Exports contain
  original file bytes, not the sanitized preview representation.

## Rendering and Security

- File menus share one order: copy relative path, copy filename, edit, history,
  share content, download, reload/retry, delete. Unavailable actions are omitted
  without changing the remaining order. Only preview pages offer reload (retry
  after a load/render error); preview toolbar download remains a shortcut.
- Edit/delete are offered only for confirmed existing worktree files in an
  unarchived session owned by the user or shared with admin access. Shared edit
  access does not grant file-write or shell permission. Editing also requires
  readable text. Index, commit, deleted and unknown file states hide mutations.
  Share content requires nonempty text and platform sharing support; it is
  separate from downloading original bytes.

- Download is available in file-page overflow menus, including binary, loading
  and error states, and in preview/full-screen toolbars. Existing text sharing
  remains separate. Files too large to preview can still be downloaded.
- A loaded preview exports its exact cached original bytes. Otherwise download
  resolves the requested worktree/index/commit version, including renamed files
  and the previous version of deleted files. Failed version resolution never
  falls back to another version or to the old whole-file read RPC.
- Downloads display transferred bytes and progress, with cancellation. Unmounting
  the file page or changing its file/version cancels the transfer. Native writes chunks to a temporary file
  and exports through system sharing; incomplete files are cleaned up. Web
  accumulates binary chunks for a Blob download, not a whole-file Base64 string.
- HTML and Markdown offer a dark reading mode that overrides author foreground,
  background and border colors. PDF dark mode recolors the reader and inverts
  canvas colors (including images), without resetting page, search or zoom state.
  These display transformations never affect exported bytes. The web PDF reader
  accepts only a boolean theme message from its parent; native uses a fixed
  theme-style injection, without exposing an application message bridge.

- SVG is loaded as an image inside an isolated document, never inserted into
  the app DOM. The image document has no script capability or external resource
  permissions. Zoom, background contrast and full-screen viewing are available.
- HTML is parsed with htmlparser2 and reconstructed from allowed static nodes.
  Inline CSS and embedded raster images are supported. Scripts, events, forms,
  navigation, nested documents and external/relative resource loading are not.
  A restrictive CSP is applied in addition to the iframe/WebView restrictions.
- Markdown reuses the app's parser, with a separate escaped HTML serializer.
  Headings, lists, quotations, tables and code blocks are supported. Raw HTML
  remains text; Mermaid remains code; chat options become inert list items.
  Links are inert and remote/relative images are represented by their alt text.
- PDF.js is bundled locally with its worker, CMaps, fonts and WASM decoders.
  Only the trusted reader code executes. There is no annotation/action layer,
  JavaScript document scripting, XFA/form editing, signing, attachment execution,
  OCR, password prompt, or binary/visual diff. Encrypted/damaged files show errors.
  Page navigation, fit-width/zoom, text selection and page-level text search are
  supported. Only one page is rendered at a time, with an 8-million-pixel canvas
  budget and a 16-million-pixel embedded-image limit.
- Web/Tauri use sandboxed iframes without `allow-same-origin`. Native uses
  WebViews without file access, navigation, cookies or application messaging.
  Native script execution is enabled only for the bundled PDF reader.

## Transport and Limits

`happy-wire/src/filePreview.ts` defines the typed contract and shared limits.
The CLI's per-session handlers expose:

1. `openFilePreview`: validate the request and permitted paths, read a bounded
   snapshot, return type/version/diff metadata and a random token.
2. `readFilePreviewChunk`: read at most 192 KiB of binary data as Base64.
3. `closeFilePreview`: release the snapshot when complete or cancelled.

Text previews are limited to 2 MiB of UTF-8; images/PDFs to 20 MiB. Limits are
checked before content transfer and again in the client. Git blobs bypass
shell/text conversion. Diff output is capped at 512 KiB and fails independently
of content viewing. Snapshots expire after two minutes of inactivity, with a 40 MiB per-session
cache budget. Out-of-workspace paths, external symlinks, Git symlink blobs,
submodules and conflicted index entries are rejected. Files exceeding the limit
can use the independent download RPCs up to 100 MiB:

1. `openFileDownload`: same path/version/security checks, no extension restriction
   or rendered diff, returning an immutable snapshot token.
2. `readFileDownloadChunk`: at most 192 KiB per request, with validated offsets.
3. `closeFileDownload`: idempotently releases the session-local snapshot.

Download snapshots are separate from the preview cache. Each session permits
one opening/active download snapshot (up to 100 MiB); another is rejected instead
of evicting an active transfer. Snapshots expire after two minutes of inactivity.
Completion, cancellation and client failures release the token; an open RPC that
finishes after cancellation is also cleaned up. If disconnected, TTL is the
fallback cleanup. Read-only shared-session users can download within their
existing session read permission; no filesystem or shell permission is added.

The CLI currently buffers one bounded download snapshot in memory. Web browsers
also hold up to 100 MiB of chunk data plus Blob/runtime overhead; this is not an
unbounded streaming-download implementation. Cancellation stops transfer/save,
but cannot revoke a file already handed to the browser or the native share sheet.

## Build and Verification

Metro invokes `sources/scripts/buildFilePreview.cjs` to generate the ignored,
self-contained PDF reader HTML asset, loaded only when opening a PDF. No CDN
or extra native PDF dependency is used.
PDF.js 5.4.624 is pinned for compatibility with the repository's Node 20 CI.

Run `yarn build` in happy-wire after protocol changes, then `yarn typecheck` in
happy-app and happy-cli. Focused Vitest coverage lives alongside the new preview
modules and covers versions, deletion/rename, bounds, chunk integrity,
cancellation, path restrictions, HTML sanitization and Markdown rendering.

For browser QA, run `npx tsx sources/scripts/filePreviewFixtures.ts` in happy-app.
This generates local sandbox fixtures under `output/playwright/file-preview`.
Test both desktop and narrow viewports, PDF navigation/search, canvas pixels,
malformed PDFs and external-request blocking. Native iOS/Android and Tauri
rendering must be validated separately; Chromium viewport tests are not evidence
of native compatibility or native memory performance.
