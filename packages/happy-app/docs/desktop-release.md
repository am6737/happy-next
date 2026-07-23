# Desktop release operations

This document covers the direct-download macOS and Windows desktop release path. It intentionally contains no credential values, certificates, passwords, tokens, or private keys.

## Release targets

- macOS 12+ Universal DMG and zipped application
- Windows x64 MSI and NSIS installer
- Windows ARM64 MSI and NSIS installer
- GitHub Releases distribution
- Windows artifacts are intentionally unsigned for the first release

A tag build is not an installation or upgrade verification. Record real-machine results separately.

## Required GitHub Actions Secrets for macOS

Configure these repository or environment Secrets before a release tag is pushed:

- `APPLE_CERTIFICATE_BASE64`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password protecting the `.p12`
- `APPLE_KEYCHAIN_PASSWORD`: random password used only for the temporary CI keychain
- `APPLE_SIGNING_IDENTITY`: complete Developer ID Application identity
- `ASC_API_KEY_ID`: App Store Connect API key identifier used for notarization
- `ASC_API_KEY_P8_BASE64`: base64-encoded App Store Connect API private key
- `ASC_ISSUER_ID`: App Store Connect issuer identifier

The workflow validates only that each value is present. It must never print the value. The certificate is decoded under `$RUNNER_TEMP`, imported into a temporary keychain, and deleted in an `always()` cleanup step.

The existing App Store Connect API key Secrets are reused for notarization, avoiding an Apple ID app-specific password. Confirm that the key belongs to the same Apple team and has permission to submit Developer ID software for notarization.

## Tag release flow

`.github/workflows/release.yml` performs the following for a `vX.Y.Z` tag:

1. builds Android APK/AAB and iOS IPA using the existing mobile release flow;
2. builds unsigned Windows x64 and ARM64 MSI and NSIS installers on native GitHub-hosted runners;
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

## Desktop-only manual release flow

`.github/workflows/desktop-release.yml` builds the production desktop application from the selected workflow ref without triggering Android, iOS, or Docker publishing. It currently supports appending desktop artifacts to an existing `vX.Y.Z` GitHub Release.

Required inputs:

- `release_tag`: an existing GitHub Release tag;
- `publish_update_manifest`: whether that Release should receive `latest.json`;
- `confirmation`: the exact value `APPEND-DESKTOP`.

The workflow uses the production product name and identifier. It refuses to:

- accept a non-semantic `vX.Y.Z` tag;
- modify a Release that already contains desktop assets;
- overwrite an existing asset;
- publish `latest.json` to a Release that is not currently the newest GitHub Release.

The application version is derived from the target Release tag, while `desktop-build-metadata.json` records the actual source commit used for the desktop build. This is important when desktop assets are appended after the original tag was created.

For the initial production-path updater test:

1. append version 2.7.5 installers to Release `v2.7.5` without `latest.json`;
2. append version 2.7.6 installers and `latest.json` to Release `v2.7.6`;
3. install the v2.7.5 desktop application from GitHub;
4. verify it discovers, downloads, and installs v2.7.6.

This validates the release and updater mechanism, but both desktop binaries are built from the current source commit. They are not historical reconstructions of the original v2.7.5 and v2.7.6 source trees.

## Unsigned CI

`.github/workflows/desktop-ci.yml` remains credential-free. It runs TypeScript checks and the app test suite, then builds:

- unsigned macOS Universal `.app/.dmg` artifacts;
- unsigned Windows x64 MSI/NSIS artifacts.
- unsigned Windows ARM64 MSI/NSIS artifacts.

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
- requires architecture-specific signed Windows x64 and ARM64 updater artifacts, preferring `.nsis.zip` and falling back to `.msi.zip`;
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

### Windows ARM64

- Download both MSI and NSIS artifacts on a real Windows 11 ARM64 machine.
- Record the expected unsigned SmartScreen/unknown-publisher warning.
- Install, launch, sign in, exercise notifications/tray/taskbar/shortcuts/media, and uninstall.
- Test overwrite installation with a newer ARM64 version, or mark real-machine status **未验证**.

### Updater

- install a previously published version;
- publish a newer signed version;
- verify discovery, download, signature validation, installation, and restart;
- verify failure leaves the old installation usable;
- record the result as **Upgrade verified** only after real-machine completion.
