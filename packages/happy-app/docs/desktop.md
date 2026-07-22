# Desktop client (Tauri 2)

Happy Next desktop uses the Expo/React Native Web application as its UI and Tauri 2 as the native shell. Production builds export the web application to `dist` and embed those files in the desktop executable; API, authentication, Session, and Socket.IO traffic still targets a remote Happy server.

## Local prerequisites

- Node.js 20 (the release CI baseline)
- Yarn 1.22.22
- Rust 1.77.2 or newer
- macOS: Xcode Command Line Tools and Xcode
- Windows: the Tauri 2 Windows prerequisites, including WebView2 and the MSVC toolchain

Run `yarn install --frozen-lockfile` from the repository root before building.

## Build variants

Run these commands from `packages/happy-app`:

```bash
yarn tauri:dev
yarn tauri:build:dev
yarn tauri:build:preview
yarn tauri:build:production
```

Each command sets `APP_ENV` explicitly before Tauri starts Expo. This is important because `app.config.js` otherwise defaults to the development variant.

Production uses `src-tauri/tauri.conf.json`. Development and preview merge their partial configuration from `tauri.dev.conf.json` and `tauri.preview.conf.json`.

The production desktop app uses the same server model as the web app: it starts with the built-in Happy server entry points and still lets the user select a custom Happy server. Production WebView connections therefore allow HTTPS/WSS endpoints but reject plain HTTP/WS. Preview may connect to configurable HTTP/WS test servers, while development disables CSP for the Expo development server. The application uses the Web platform `fetch` implementation, so the unused Tauri HTTP plugin is not bundled or exposed through capabilities.

React Native Web and Unistyles create style rules dynamically at runtime. Tauri's build-time CSP rewriting is therefore disabled only for `style-src`; the explicit `style-src 'self' 'unsafe-inline'` policy remains in force. Script CSP rewriting remains enabled.

## Desktop product behavior

The desktop shell intentionally behaves like a resident messaging client rather than a browser tab:

- Closing the main window hides it to the system tray by default and keeps Socket.IO connected.
- The tray menu can show, hide, or explicitly quit Happy Next and displays the current unread count.
- Clicking the tray icon toggles the main window. Clicking the macOS Dock icon reopens a hidden window.
- `Cmd+Q` on macOS and **Quit Happy Next** in the tray menu exit the process instead of hiding it.
- A second launch activates the existing window instead of creating another instance.
- Background WebView throttling is disabled so hidden-window message delivery is not intentionally suspended.
- Native notifications are emitted for new agent replies and messages from another user when the relevant Session is not focused. Own messages, tool-only updates, events, and the currently visible Session are not notified.
- Notification clicks request that the app show the main window and navigate to the associated Session. This still requires real-machine verification on each operating system.
- macOS uses the Dock badge; Windows uses a taskbar overlay indicator; the tray menu provides a numeric count on both platforms.
- The global show/hide shortcut is `Cmd+Shift+H` on macOS and `Ctrl+Shift+H` on Windows.
- Launch-at-sign-in is disabled by default. When enabled, Happy Next starts hidden in the tray.

Users can change close-to-tray, desktop notifications, launch-at-sign-in, and the global shortcut under **Settings → Notifications**. Close-to-tray, desktop notifications, and the shortcut are enabled by default; launch-at-sign-in is opt-in.

Desktop-specific Tauri permissions are deliberately limited to notification permission/send/listener calls, autostart enable/disable/status calls, and global shortcut register/unregister/status calls.

## Local data behavior

- authentication credentials use macOS Keychain or Windows Credential Manager through native Tauri commands and are never intentionally logged;
- device-local settings and drafts use the React Native MMKV Web adapter, which also persists through `localStorage`;
- encrypted message cache rows and coverage state use IndexedDB (`happy-message-cache-v1`).

The first desktop version with system credential storage deletes the legacy `auth_credentials` value from WebView `localStorage` without migrating it. Existing desktop users must sign in once again. There is intentionally no legacy credential migration or rollback path; credentials created after that sign-in are written only to the operating system credential store.

Image files can already be dragged into the composer on Web/Tauri, and clipboard image paste is handled by the existing Web paste path. Text copy/paste uses the existing Expo/Web clipboard implementation. These paths were kept instead of adding redundant broad native clipboard or filesystem capabilities.

Generated bundles are written below `src-tauri/target/release/bundle/`. The `dist` and `target` directories are generated and must not be committed.

## Local verification

Before treating a desktop change as ready, run:

```bash
yarn typecheck
cd src-tauri
cargo fmt -- --check
cargo check --locked
```

For a production-shell smoke build without installers:

```bash
yarn tauri:build:production --no-bundle
```

For local macOS artifacts:

```bash
yarn tauri:build:production --bundles app,dmg
```

An unsigned or ad-hoc-signed local bundle is only a development artifact. It does not replace Developer ID signing, notarization, stapling, Gatekeeper verification, or installation tests on a clean Mac.

Desktop interaction checks should include:

1. close the window and confirm the process remains in the tray;
2. restore it from the tray and, on macOS, from the Dock;
3. launch a second instance and confirm the existing window is focused;
4. toggle the global shortcut setting and exercise `Cmd/Ctrl+Shift+H`;
5. enable launch-at-sign-in and verify a hidden launch after a real OS sign-out/sign-in cycle;
6. receive a message while another Session is visible and while the window is hidden;
7. click a notification and confirm the correct Session opens;
8. drag and paste an image into the composer;
9. upgrade from a build that used WebView credentials and confirm it requires one new sign-in;
10. quit and relaunch, then confirm the Keychain/Credential Manager login, settings, drafts, and cached messages persist.

Tests that require actual OS notification centers, login startup, taskbar/Dock state, credential-store persistence, or shell interaction are **未验证** until performed on a real machine; compilation alone is not sufficient.

## Signing and release safety

- Never commit certificates, passwords, tokens, updater private keys, provisioning files, or generated key material.
- Never echo secret values in scripts or GitHub Actions logs.
- Developer ID credentials and the updater private key must be provided only through GitHub Actions Secrets.
- Keep an offline backup of the updater private key. Only the updater public key belongs in the client configuration.
- Do not overwrite an existing GitHub Release without explicit approval.
- Windows artifacts are intentionally unsigned for the first release and will show SmartScreen/unknown-publisher warnings.

Tag releases build Windows x64 MSI and NSIS installers in `.github/workflows/release.yml`. The tag version is stripped of its leading `v` and passed to both Expo (`APP_VERSION`) and Tauri (`TAURI_CONFIG`) so the installer metadata matches the GitHub Release version. These artifacts remain **未验证** until installed and uninstalled on a real Windows x64 machine.

## Verification status terminology

- **Build verified**: compilation or packaging completed on the named runner/host.
- **Install verified**: the installer was tested on a real machine.
- **Upgrade verified**: a previously released version successfully updated through the configured updater.

A successful CI build is not a macOS or Windows installation verification. Release notes and checklists must explicitly mark missing real-device checks as **未验证**.

## Pending release configuration

The following items must be finalized before public desktop releases:

- macOS 12+ Universal packaging and real-device coverage on both Apple Silicon and Intel;
- Windows x64 packaging and real-device installation coverage;
- validation of production HTTPS/WSS custom servers and preview HTTP/WS test servers;
- production version synchronization between the Git tag, Expo config, Cargo, Tauri, installer names, and updater metadata;
- Developer ID signing, notarization, stapling, and Gatekeeper checks;
- GitHub Release desktop jobs and updater metadata/signatures;
- Windows real-machine MSI/NSIS installation checks;
- old-version-to-new-version updater tests.
