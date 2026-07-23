# Desktop release operations

This document covers the direct-download macOS and Windows desktop release path. It intentionally contains no credential values, certificates, passwords, tokens, or private keys.

## Release targets

- macOS 12+ Universal DMG, zipped application, and signed updater archive
- Windows x64 MSI and NSIS installer
- Windows ARM64 MSI and NSIS installer
- Android APK/AAB and iOS IPA in the same GitHub Release
- GitHub Releases distribution
- Windows installers are intentionally unsigned for the first release

A successful CI build is not proof of installation or upgrade behavior. Record real-machine results separately.

## Release asset naming

Every versioned asset uses lowercase ASCII and hyphens:

```text
happy-next-vX.Y.Z-android.apk
happy-next-vX.Y.Z-android.aab
happy-next-vX.Y.Z-ios.ipa
happy-next-vX.Y.Z-macos-universal.dmg
happy-next-vX.Y.Z-macos-universal.zip
happy-next-vX.Y.Z-macos-universal.app.tar.gz
happy-next-vX.Y.Z-macos-universal.app.tar.gz.sig
happy-next-vX.Y.Z-windows-x64-setup.exe
happy-next-vX.Y.Z-windows-x64-setup.exe.sig
happy-next-vX.Y.Z-windows-x64.msi
happy-next-vX.Y.Z-windows-x64.msi.sig
happy-next-vX.Y.Z-windows-arm64-setup.exe
happy-next-vX.Y.Z-windows-arm64-setup.exe.sig
happy-next-vX.Y.Z-windows-arm64.msi
happy-next-vX.Y.Z-windows-arm64.msi.sig
happy-next-vX.Y.Z-desktop-metadata.json
happy-next-vX.Y.Z-sha256sums.txt
```

`latest.json` is the only unversioned asset because the production client uses a fixed updater endpoint.

Do not put spaces in Release asset names. GitHub normalizes uploaded names containing spaces, which can make a pre-generated updater URL return 404.

## Required GitHub Actions Secrets

### Desktop updater signing

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### macOS Developer ID and notarization

- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `ASC_API_KEY_ID`
- `ASC_API_KEY_P8_BASE64`
- `ASC_ISSUER_ID`

The workflow checks only whether each Secret is present. It must never print a credential value. Temporary certificates, API keys, and keychains are created under `$RUNNER_TEMP` and deleted in cleanup steps.

Never commit a private updater key. Keep it only in GitHub Actions Secrets and an approved offline backup. The updater public key may be committed in `src-tauri/tauri.conf.json`.

## Publishing model

Publishing is intentionally split into independent manual workflows:

| Product line | Workflow | Confirmation |
|---|---|---|
| GitHub Release: Android, iOS IPA, macOS, Windows | `.github/workflows/release.yml` | `PUBLISH-RELEASE` |
| Docker images | `.github/workflows/docker-publish.yml` | `PUBLISH-DOCKER` |
| Existing IPA to iOS App Store | `.github/workflows/ios-submit.yml` | `SUBMIT-IOS` |
| CLI npm package | `.github/workflows/cli-publish.yml` | workflow-specific |

A release skill creates and pushes the immutable `vX.Y.Z` tag first, then explicitly dispatches only the selected workflows. Pushing a tag by itself does not publish GitHub or Docker assets.

The old desktop-only workflow was removed. Desktop artifacts are always released with the mobile GitHub Release so `latest.json`, source tag, mobile binaries, and desktop binaries remain consistent.

## GitHub Release workflow

`.github/workflows/release.yml` accepts:

- `release_tag`: an existing `vX.Y.Z` tag
- `confirmation`: exactly `PUBLISH-RELEASE`

The workflow:

1. verifies the tag exists and the GitHub Release does not;
2. checks out that exact tag in every build job;
3. builds Android APK/AAB and iOS IPA;
4. builds Windows x64 and ARM64 MSI/NSIS installers;
5. signs Windows updater payloads with the Tauri updater key;
6. builds a macOS Universal application;
7. signs it with Developer ID and submits the application for notarization;
8. separately notarizes and staples the DMG;
9. validates application version, signatures, stapling, and Gatekeeper;
10. renames every staged asset to the normalized `happy-next-vX.Y.Z-*` format;
11. generates `latest.json`, desktop metadata, and SHA256 checksums;
12. refuses unexpected asset names or an existing Release;
13. creates the immutable GitHub Release.

The version is passed to Expo with `APP_VERSION` and to Tauri through a temporary config supplied with `tauri build --config`. Both macOS and Windows jobs fail if the bundled installer version does not match the requested tag.

## iOS App Store submission

`.github/workflows/ios-submit.yml` does not rebuild the application. It requires an existing GitHub Release containing:

```text
happy-next-vX.Y.Z-ios.ipa
```

It downloads that exact IPA and submits it through EAS using the App Store Connect API key. This guarantees the App Store submission and GitHub Release refer to the same binary.

## Docker publication

`.github/workflows/docker-publish.yml` accepts an existing tag and checks out that exact source revision. It publishes versioned multi-architecture images independently from the GitHub Release workflow.

Updating Docker `latest` is an explicit boolean input. Do not update `latest` when intentionally republishing an older version.

## Updater foundation

The production client checks:

```text
https://github.com/hitosea/happy-next/releases/latest/download/latest.json
```

`sources/scripts/generateDesktopUpdateManifest.cjs`:

- validates semantic versions and release tags;
- requires a signed macOS `.app.tar.gz`;
- requires signed Windows x64 and ARM64 payloads;
- supports current `.exe`/`.msi` updater payloads and legacy `.nsis.zip`/`.msi.zip` payloads;
- maps the Universal macOS archive to both Darwin architectures;
- reads detached signatures without printing them;
- writes exact GitHub Release asset URLs.

Windows installers remain unsigned at the operating-system level, even though updater payloads are cryptographically signed with the Tauri updater key.

## Release verification checklist

### Artifact inspection

- Every versioned asset starts with `happy-next-vX.Y.Z-`.
- Only `latest.json` is unversioned.
- `latest.json` contains `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, and `windows-aarch64`.
- Every updater URL returns HTTP 200.
- Every updater payload has a matching detached signature.
- Metadata records the tag version and source commit.

### macOS

- Download the DMG on a clean Apple Silicon Mac.
- Confirm Gatekeeper opens it without an unidentified-developer warning.
- Confirm identity with `codesign -dv --verbose=4`.
- Confirm notarization with `spctl --assess --type execute --verbose=4`.
- Install, launch, sign in, receive a notification, send an image, use microphone/camera, quit, and relaunch.
- Repeat on Intel hardware or mark Intel testing **未验证**.

### Windows x64 and ARM64

For each architecture:

- Test both MSI and NSIS on a real supported Windows machine.
- Record the expected unsigned SmartScreen/unknown-publisher warning.
- Install, launch, sign in, exercise notifications/tray/taskbar/shortcuts/media, and uninstall.
- Test upgrading from an older release.
- Mark any architecture without a real device as **未验证**.

### Updater

1. Install a genuinely older GitHub Release.
2. Publish a newer signed GitHub Release.
3. Verify background discovery and download.
4. Verify the in-app update button appears in logged-out and logged-in layouts.
5. Install and restart through the updater.
6. Confirm the displayed version, login state, and local data after restart.
7. Confirm a failed update leaves the old installation usable.

Only record **Upgrade verified** after completing these steps on a real machine.
