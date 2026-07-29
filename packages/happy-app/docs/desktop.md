# Desktop client (Tauri 2)

Happy Next desktop embeds the Expo/React Native Web export in a Tauri 2 native shell. Production builds load the packaged `dist` directory; authentication, Sessions, messages, Socket.IO, uploads, and voice services continue to use a remote Happy server.

This document describes the current implementation. A successful build is not considered a real-device installation or upgrade verification.

## Supported baseline

- macOS 12 or newer, Universal (`aarch64` + `x86_64`)
- Windows 10/11 x64 and ARM64
- Direct download through GitHub Releases
- macOS public releases: Developer ID signing and Apple notarization required
- Windows first release: unsigned, so SmartScreen/unknown-publisher warnings are expected
- Linux is not a release target

## Local prerequisites

- Node.js 20 (release CI baseline)
- Yarn 1.22.22
- Rust 1.77.2 or newer
- macOS: Xcode 26 and Xcode Command Line Tools (required to compile the layered macOS 26 icon; deployment remains macOS 12+)
- Windows: WebView2 and the MSVC Tauri prerequisites

Install dependencies from the repository root:

```bash
yarn install --frozen-lockfile
```

## Build variants

Run from `packages/happy-app`:

```bash
yarn tauri:dev
yarn tauri:dev:inspect
yarn tauri:build:dev
yarn tauri:build:preview
yarn tauri:build:production
yarn tauri:build:macos:universal
yarn tauri:build:windows:x64
```

Development uses `tauri.dev.conf.json`, the separate `com.hitosea.happy.dev` identifier, port 8082, and no CSP so Metro and Web Inspector can work. Preview merges `tauri.preview.conf.json` and permits configurable HTTP/HTTPS/WS/WSS test endpoints. Production uses `tauri.conf.json`, packaged local assets, and HTTPS/WSS remote connections only.

The app starts with built-in Happy server endpoints and lets the user configure a custom Happy server. Production custom endpoints must use HTTPS/WSS; plain HTTP/WS is limited to development and preview testing.

React Native Web and Unistyles create runtime styles. Production keeps `style-src 'self' 'unsafe-inline'` and disables only Tauri's build-time CSP rewriting for `style-src`. Blob URLs are allowed where required for image paste/upload and workers. The Tauri HTTP plugin is not exposed; application traffic uses the WebView `fetch` implementation.

Generated `dist` and `src-tauri/target` contents must not be committed.

## Current desktop behavior

### Window lifecycle

- The native bootstrap cache is stored outside WebView storage in the Tauri app-data directory as `desktop-bootstrap.json`.
- The cache contains only last authentication state, theme preference, and authenticated window geometry. It does not contain login credentials.
- Before the WebView finishes loading, Tauri uses the cache to choose the initial theme, window size, position, and macOS traffic-light position.
- Signed-out mode is centered at `800 × 600`, is not resizable, and uses the signed-out traffic-light layout.
- Signed-in mode defaults to `1440 × 900`, has a minimum of `1100 × 700`, is resizable, and restores its previous size, position, and maximized state.
- Restored geometry is clamped to an available monitor with an edge margin, preventing an old off-screen position from making the app inaccessible.
- macOS uses an overlay title bar and native traffic lights. The signed-in and signed-out layouts have separate fixed traffic-light positions.
- Custom drag regions avoid interactive controls and selectable title text.
- Closing the main window hides it to the tray by default. Explicit Quit exits the process.
- Clicking the macOS Dock icon or launching a second instance shows and activates the existing main window.
- Background throttling is disabled so hiding the window does not intentionally suspend Socket.IO processing.

### Desktop icons

- `sources/assets/images/icon.png` is the full-bleed 1024×1024 desktop icon master.
- Run `yarn desktop:icons` after changing the master. The generator creates separate optical variants for macOS and Windows rather than scaling one precomposed icon everywhere.
- macOS 26+ uses the layered `src-tauri/icons/HappyNext.icon` source compiled into `Assets.car`, with a full-bleed opaque background and system-applied masking. `src-tauri/icons/icon.icns` remains the fallback for macOS 12–25.
- Windows uses a fuller canvas and independently optimized 16px, 24px, 32px, 48px, 64px, and 256px representations in `src-tauri/icons/icon.ico`.
- The generator also refreshes the standard Tauri PNG icon sizes. It does not generate unused Windows Store tiles or modify the iOS, Android, favicon, or tray icon assets.

### Tray, badges, and notifications

- macOS uses the dedicated template asset `src-tauri/icons/tray-icon.png`; it adapts to light and dark menu bars.
- Windows currently uses the application icon for its tray icon.
- The tray icon itself does not display a numeric badge or title.
- The tray tooltip and disabled menu status line may describe the unread count.
- macOS unread count is shown on the Dock badge. Windows uses a taskbar overlay indicator.
- Signing out clears the desktop unread count.
- Notifications are generated for relevant new agent replies and messages from another user when the Session should notify under the user's notification settings.
- Own messages, tool-only updates, events, duplicate messages, and the currently focused Session do not produce a native notification.
- Notification clicks show and activate the app, then navigate to the associated Session.
- Notification permission is requested only when desktop notifications are enabled.

The notification click path has been exercised locally on macOS. Windows notification delivery, activation, and taskbar integration remain **未验证** until tested on real Windows x64 and ARM64 machines.

### Desktop settings and shortcuts

The following settings are available under **Settings → Notifications**:

- desktop notifications: enabled by default
- close to tray: enabled by default
- launch at sign-in: disabled by default
- global show/hide shortcut: enabled by default

The global shortcut is `Cmd+Shift+H` on macOS and `Ctrl+Shift+H` on Windows.

Application shortcuts currently include:

| Action | macOS | Windows |
| --- | --- | --- |
| Search | `Cmd+K` or `Cmd+F` | `Ctrl+K` or `Ctrl+F` |
| New Session | `Cmd+N` | `Ctrl+N` |
| Sessions | `Cmd+1` | `Ctrl+1` |
| Inbox | `Cmd+2` | `Ctrl+2` |
| DooTask | `Cmd+3` | `Ctrl+3` |
| Settings | `Cmd+,` or `Cmd+4` | `Ctrl+,` or `Ctrl+4` |
| Back | `Cmd+[` | `Alt+Left` |
| Forward | `Cmd+]` | `Alt+Right` |

The native application menu exposes New Session, Search/Find, primary navigation, Settings, Back/Forward, standard Edit commands, and standard Window commands. Command-palette shortcut labels follow the current desktop platform instead of always showing macOS glyphs.

### Permissions and links

- External HTTP/HTTPS links open in the system browser.
- macOS bundles declare microphone and camera usage descriptions.
- The macOS entitlements include audio-input and camera access for the hardened runtime.
- Tauri capabilities are limited to window dragging, approved URL opening, notifications, autostart, and global shortcuts.
- Core Tauri access is enumerated per command; the frontend is not granted `core:default`, filesystem, shell, process, or arbitrary path-opening permissions.
- External navigation accepts only HTTP, HTTPS, `mailto:`, and `tel:` URLs. Script, file, data, and custom protocols are blocked from the generic external-link path.
- Image drag/drop and clipboard paste reuse the existing Web upload paths rather than broad native filesystem or clipboard permissions.
- Microphone denial guidance distinguishes the Tauri app from a browser and directs users to the operating-system privacy settings.

### Software updates

- Production builds check the official GitHub Releases `latest.json` endpoint after startup without delaying the initial window.
- Update checks are disabled for development and preview identifiers.
- After discovering an available update, production builds download the signed updater payload in the background without interrupting the user.
- Updates are never installed silently. When the payload is ready, signed-out layouts show an **Update** button in the lower-right corner and signed-in layouts show it after the Settings icon; clicking it installs the verified payload and restarts the app.
- Download progress, release notes, retry state, and a manual **Settings → Software update** action are available in the app.
- The native application menu also exposes **Check for Updates…**.
- Update archives are verified with the public key embedded in `tauri.conf.json`; the private key and its password are stored only in GitHub Actions Secrets and the separately managed encrypted backup.

### Diagnostics and failure recovery

- **Settings → Desktop diagnostics** shows the app version, identifier, operating system, architecture, build profile, sanitized server endpoint, and Socket.IO state.
- Diagnostic information can be copied without login credentials, URL credentials/query strings, message content, or profile data.
- The diagnostics screen can test the current app-config endpoint and open the native log directory.
- Native logs rotate locally, keeping up to three files with a 1 MB limit per file.
- Image uploads have a 60-second timeout. Upload/send failures keep the composer content available for retry and show a user-visible error instead of only producing an unhandled promise rejection.
- Native window operations catch and report rejected platform calls instead of leaving unhandled promises; Windows title-bar controls expose keyboard focus indicators and accessible labels.

## Local data and authentication

The desktop WebView currently follows the Web storage model:

- login credentials are stored in WebView `localStorage` under `auth_credentials`;
- device-local settings and drafts use the MMKV Web adapter backed by `localStorage`;
- encrypted message cache rows and coverage state use IndexedDB (`happy-message-cache-v1`);
- native bootstrap state is stored separately in `desktop-bootstrap.json` so the shell can restore the window before WebView startup.

The session-list cache coalesces updates and avoids rewriting identical content because WebKit stores each
`localStorage` write in a SQLite WAL. On macOS, a one-time pre-WebView migration removes legacy LocalStorage
databases that may contain oversized WAL files. Existing desktop users must sign in again and may lose local-only
settings and drafts. IndexedDB message caches are not removed. A marker in the app-support directory prevents the
reset from running again; failed resets remain unmarked and retry on the next launch.

The desktop client does **not** currently use macOS Keychain or Windows Credential Manager. Moving credentials to native secure storage would change the authentication/storage model and requires a separate product and migration decision. Never log credential values or include them in diagnostic output.

## Verification commands

After TypeScript changes:

```bash
yarn typecheck
```

Run focused tests where applicable:

```bash
npx vitest run sources/desktop/desktopWindowUtils.test.ts
npx vitest run sources/desktop/desktopKeyboardShortcuts.test.ts
npx vitest run sources/desktop/DesktopBridge.test.ts
npx vitest run sources/auth/tokenStorage.test.ts
```

After Rust or Tauri configuration changes:

```bash
cd src-tauri
cargo fmt -- --check
cargo check --locked
```

After changing the desktop icon master or icon generator:

```bash
yarn desktop:icons
yarn desktop:icon:macos
```

The second command is macOS-only and requires Xcode 26. Its `Assets.car` output is generated during builds and must not be committed.

Production-shell smoke build without installers:

```bash
yarn tauri:build:production --no-bundle
```

Local unsigned macOS bundles:

```bash
yarn tauri:build:production --bundles app,dmg
```

Unsigned/ad-hoc local artifacts are development builds. They do not replace Developer ID signing, notarization, stapling, Gatekeeper verification, or testing on a clean machine.

## Test matrix

Use these status terms consistently:

- **Build verified**: compilation or packaging completed on the named host/runner.
- **Interaction verified**: the behavior was exercised on a real machine.
- **Install verified**: an installer was installed and removed on a real machine.
- **Upgrade verified**: an installed older version successfully updated to the new version.
- **未验证**: no equivalent real-machine verification has been completed.

### macOS regression checklist

1. Signed-out launch is centered at 800 × 600, fixed-size, correctly themed, and uses the signed-out traffic-light alignment.
2. Signing in switches to the signed-in traffic-light layout and 1440 × 900 default geometry without visible jumps.
3. Manual resize, move, maximize, quit, and relaunch restore the authenticated geometry.
4. Saved off-screen geometry is clamped after monitor removal or resolution changes.
5. The custom title area drags the window while titles and normal content remain selectable.
6. Close-to-tray, tray restore, Dock restore, and explicit Quit behave correctly.
7. A second launch activates the existing instance.
8. Desktop notifications arrive, activate a hidden/background window, and navigate to the correct Session.
9. Opening the current Session and signing out clear the appropriate Dock unread state.
10. Application and global shortcuts work without breaking text input or composition.
11. Launch-at-sign-in starts hidden after a real OS sign-out/sign-in cycle.
12. Image paste, image drag/drop, image-only send, microphone, camera, and voice assistant work in a production build.
13. Default and custom HTTPS/WSS Happy servers connect successfully.

### Windows x64 and ARM64 checklist — currently 未验证

Run the checklist separately on each architecture:

1. Install and uninstall both MSI and NSIS artifacts.
2. Verify overwrite install and retained/removed user data behavior.
3. Verify frameless drag, resize, minimize, maximize/restore, Snap Layout, and DPI scaling.
4. Verify tray hide/restore/quit and single-instance activation.
5. Verify native notifications, notification click navigation, and taskbar unread state.
6. Verify autostart and `Ctrl+Shift+H` after a real sign-out/sign-in cycle.
7. Verify microphone, camera, image paste/drop/upload, and voice assistant.
8. Verify default and custom server connections.
9. Verify installation under non-ASCII usernames and paths.
10. Record expected unsigned SmartScreen/unknown-publisher prompts.

## CI and release status

`.github/workflows/desktop-ci.yml` currently builds unsigned artifacts for:

- macOS 12+ Universal `.app/.dmg`
- Windows x64 MSI/NSIS
- Windows ARM64 MSI/NSIS

Tag releases in `.github/workflows/release.yml` include Windows x64 and ARM64 installers and a macOS Universal job that compiles the layered icon with Xcode 26, imports a temporary Developer ID certificate, signs, notarizes, validates staples, runs Gatekeeper checks, and uploads DMG/zip artifacts. The job cannot be considered verified until the required Apple Secrets are configured and a real tag run succeeds. See `docs/desktop-release.md`.

Before a public desktop release, complete all of the following:

- synchronize the Git tag, Expo version, Cargo/Tauri version, installer metadata, and update metadata;
- run and verify the macOS Universal Developer ID signing, notarization, stapling, and Gatekeeper job with approved Secrets;
- upload macOS and Windows artifacts to the same GitHub Release without overwriting an existing release unexpectedly;
- publish signed updater artifacts and `latest.json` through a real tag release;
- test a real old-version-to-new-version update on macOS, Windows x64, and Windows ARM64;
- complete Windows x64 and ARM64 install/uninstall verification;
- complete Apple Silicon verification and obtain Intel Mac coverage or explicitly mark it **未验证**.

## Secrets and release safety

- Never commit or print certificates, passwords, tokens, provisioning files, or updater private keys.
- Developer ID credentials and the updater private key belong only in GitHub Actions Secrets.
- Keep an offline backup of the updater private key. Only the updater public key belongs in client configuration.
- Do not replace the formal updater key without explicit approval; replacing it would prevent existing installations from trusting future updates.
- Do not use Apple credentials or overwrite an existing GitHub Release without explicit approval.
- CI success must never be reported as real-device installation or upgrade success.

## Deferred scope: local CLI integration

Local discovery, launch, and management of happy-cli, Claude Code, Codex, Gemini, or other processes is a separate P2 project. Do not add shell execution, process spawning, local IPC, or broad filesystem capabilities as part of desktop polish or release work.
