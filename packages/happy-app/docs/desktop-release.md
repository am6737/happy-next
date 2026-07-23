# Desktop release operations

This document covers the direct-download macOS and Windows desktop release path. It intentionally contains no credential values, certificates, passwords, tokens, or private keys.

## Release targets

- macOS 12+ Universal DMG and zipped application
- Windows x64 MSI and NSIS installer
- GitHub Releases distribution
- Windows artifacts are intentionally unsigned for the first release

A tag build is not an installation or upgrade verification. Record real-machine results separately.

## Required GitHub Actions Secrets for macOS

Configure these repository or environment Secrets before a release tag is pushed:

- `APPLE_CERTIFICATE_BASE64`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password protecting the `.p12`
- `APPLE_KEYCHAIN_PASSWORD`: random password used only for the temporary CI keychain
- `APPLE_SIGNING_IDENTITY`: complete Developer ID Application identity
- `APPLE_ID`: Apple account used by the notarization service
- `APPLE_PASSWORD`: app-specific password for notarization
- `APPLE_TEAM_ID`: Apple Developer team identifier

The workflow validates only that each value is present. It must never print the value. The certificate is decoded under `$RUNNER_TEMP`, imported into a temporary keychain, and deleted in an `always()` cleanup step.

Prefer migrating notarization to an App Store Connect API key later if the team wants to avoid Apple ID app-specific passwords. That change should be reviewed separately rather than mixing both credential mechanisms.

## Tag release flow

`.github/workflows/release.yml` performs the following for a `vX.Y.Z` tag:

1. builds Android APK/AAB and iOS IPA using the existing mobile release flow;
2. builds unsigned Windows x64 MSI and NSIS installers;
3. builds the macOS Universal target;
4. signs the macOS application and nested code with Developer ID;
5. submits the macOS bundle for notarization through Tauri;
6. validates the application and DMG staples;
7. runs `codesign` and Gatekeeper (`spctl`) assessments;
8. packages the application as a zip and uploads the zip and DMG;
9. refuses to continue if a GitHub Release for the tag already exists;
10. generates `SHA256SUMS.txt` and creates the GitHub Release.

The workflow strips the leading `v` and passes the same version to Expo and Tauri through `APP_VERSION` and `TAURI_CONFIG`.

Do not push a release tag until the Apple Secrets are configured. A missing Secret intentionally fails the macOS release job before certificate import.

## Unsigned CI

`.github/workflows/desktop-ci.yml` remains credential-free. It runs TypeScript checks and the app test suite, then builds:

- unsigned macOS Universal `.app/.dmg` artifacts;
- unsigned Windows x64 MSI/NSIS artifacts.

These artifacts are for build validation and internal testing only.

## Updater foundation

The production client uses the Tauri updater plugin and checks:

```text
https://github.com/hitosea/happy-next/releases/latest/download/latest.json
```

The updater public key is committed in `src-tauri/tauri.conf.json`. The encrypted private key and password are configured as GitHub Actions Secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The encrypted key backup must be moved from its temporary local directory to offline storage. The password is intentionally not stored beside the key and should remain in the approved password manager.

`sources/scripts/generateDesktopUpdateManifest.cjs` creates the Tauri static `latest.json` structure from signed updater artifacts. It:

- requires a semantic release version;
- requires a signed macOS `.app.tar.gz` artifact;
- prefers a signed Windows `.nsis.zip` artifact and falls back to `.msi.zip`;
- maps the Universal macOS artifact to both Darwin architectures;
- reads detached `.sig` files without printing their contents;
- writes GitHub Release download URLs.

The release workflow passes the updater Secrets to macOS and Windows builds, uploads updater archives and detached signatures, and generates `latest.json` before creating the GitHub Release. Windows installers remain intentionally unsigned even though their updater archives are cryptographically signed by the Tauri updater key.

Never commit a private updater key. Store it only in GitHub Actions Secrets and an offline backup. The corresponding public key may be committed once approved.

## Release verification checklist

### macOS

- Download the DMG from GitHub Releases on a clean Apple Silicon Mac.
- Confirm Gatekeeper opens the app without an unidentified-developer warning.
- Confirm the application identity with `codesign -dv --verbose=4`.
- Confirm notarization with `spctl --assess --type execute --verbose=4`.
- Install, launch, sign in, receive a notification, send an image, use microphone/camera, quit, and relaunch.
- Repeat on Intel hardware or mark Intel interaction/install status **未验证**.

### Windows x64

- Download both MSI and NSIS artifacts on a real Windows 10/11 x64 machine.
- Record the expected unsigned SmartScreen/unknown-publisher warning.
- Install, launch, sign in, exercise notifications/tray/taskbar/shortcuts/media, and uninstall.
- Test overwrite installation with a newer version.

### Updater

- install a previously published version;
- publish a newer signed version;
- verify discovery, download, signature validation, installation, and restart;
- verify failure leaves the old installation usable;
- record the result as **Upgrade verified** only after real-machine completion.
