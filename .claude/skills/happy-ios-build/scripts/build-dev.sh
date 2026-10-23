#!/bin/bash
# Debug dev client (HappyNextdev, com.hitosea.happy.dev) → development-signed IPA in appdown.
# Usage: build-dev.sh [label]
source "$(dirname "$0")/common.sh"

LABEL=$(slug "${1:-dev}")
BUNDLE_ID=com.hitosea.happy.dev
PROFILE_NAME="iOS Team Provisioning Profile: $BUNDLE_ID"
EXT_ID=$BUNDLE_ID.share-extension   # expo-share-intent's ShareExtension target
EXT_PROFILE_NAME="iOS Team Provisioning Profile: $EXT_ID"
APP_GROUP=group.$BUNDLE_ID
DD=/tmp/hn-dd   # kept between runs for incremental builds

acquire_lock
trap release_lock EXIT

cd "$REPO"
git diff --quiet HEAD || die "tracked files are modified on the Mac mini; sync the repo first"
HEAD_FULL=$(git rev-parse HEAD)
SHA=$(git rev-parse --short=8 HEAD)
TS=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d /tmp/happy-dev-$TS.XXXX)
echo "commit $SHA, work dir $WORK"

# --- dependencies / native project ---------------------------------------------
NEED_POD=0
LOCK_SHA=$(shasum -a 256 yarn.lock | cut -d' ' -f1)
if [ "$(cat "$STATE/yarn.lock.sha" 2>/dev/null || true)" != "$LOCK_SHA" ]; then
    log "yarn.lock changed → yarn install"
    run_logged "$WORK/yarn.log" yarn install --frozen-lockfile
    echo "$LOCK_SHA" > "$STATE/yarn.lock.sha"
    git rev-parse HEAD > "$STATE/patches-commit"   # its postinstall applied HEAD's patches
    NEED_POD=1   # yarn install drops prebuilt binaries that pod install fetches again
fi
sync_patches "$WORK/patches.log"

NEED_PREBUILD=0
LAST=$(cat "$STATE/dev-commit" 2>/dev/null || true)
if [ ! -d "$APP/ios/HappyNextdev.xcworkspace" ]; then
    NEED_PREBUILD=1
elif [ -z "$LAST" ] || ! git cat-file -e "$LAST^{commit}" 2>/dev/null; then
    NEED_PREBUILD=1
elif git diff --name-only "$LAST" HEAD | grep -qE '^(yarn\.lock|patches/|packages/happy-app/(package\.json|app\.config\.js|plugins/|modules/|targets/|patches/))'; then
    NEED_PREBUILD=1
fi

cd "$APP"
if [ "$NEED_PREBUILD" = 1 ]; then
    log "native inputs changed → APP_ENV=development expo prebuild --clean"
    APP_ENV=development CI=1 run_logged "$WORK/prebuild.log" npx expo prebuild -p ios --clean
elif [ "$NEED_POD" = 1 ] || ! cmp -s ios/Podfile.lock ios/Pods/Manifest.lock; then
    log "pod install"
    (cd ios && run_logged "$WORK/pod.log" pod install)
fi

# --- build (unsigned) -------------------------------------------------------------
log "xcodebuild Debug (unsigned)"
run_logged "$WORK/build.log" xcodebuild -workspace ios/HappyNextdev.xcworkspace -scheme HappyNextdev \
    -configuration Debug -destination generic/platform=iOS -derivedDataPath "$DD" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build

# --- sign ---------------------------------------------------------------------------
log "sign"
IDENTITY=$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development:/ {print $2; exit}')
[ -n "$IDENTITY" ] || die "no valid Apple Development identity in the keychain"
PROFILE=$(find_profile "$PROFILE_NAME")
[ -n "$PROFILE" ] || die "no unexpired profile named '$PROFILE_NAME' (open the project in Xcode once to refresh it)"
security cms -D -i "$PROFILE" > "$WORK/profile.plist"
EXT_PROFILE=$(find_profile "$EXT_PROFILE_NAME")
[ -n "$EXT_PROFILE" ] || die "no unexpired profile named '$EXT_PROFILE_NAME' (sign the ShareExtension target in Xcode once to create it)"
security cms -D -i "$EXT_PROFILE" > "$WORK/ext-profile.plist"
# The app and its share extension hand the shared content over through the App Group
for f in "$WORK/profile.plist" "$WORK/ext-profile.plist"; do
    $PB -c 'Print :Entitlements:com.apple.security.application-groups' "$f" 2>/dev/null | grep -qx "    $APP_GROUP" \
        || die "$($PB -c 'Print :Name' "$f") lacks the App Group $APP_GROUP (enable it on the App ID, then refresh the profile)"
done

mkdir -p "$WORK/Payload"
A="$WORK/Payload/HappyNextdev.app"
ditto "$DD/Build/Products/Debug-iphoneos/HappyNextdev.app" "$A"
# The watch widget (…dev.watchkitapp.widget) has no profile, so the dev IPA ships without the
# watch app, like the prod one.
rm -rf "$A/Watch"
X="$A/PlugIns/ShareExtension.appex"
[ -d "$X" ] || die "the app does not embed PlugIns/ShareExtension.appex"
OTHER=$(ls "$A/PlugIns" | grep -vx ShareExtension.appex || true)
[ -z "$OTHER" ] || die "the app embeds PlugIns/ this script has no profiles for: $OTHER"

# Entitlements: the project's file plus the identity keys a device build needs.
# entitlements <source> <bundle id> <out>
entitlements() {
    cp "$1" "$3"
    for k in application-identifier com.apple.developer.team-identifier get-task-allow keychain-access-groups; do
        $PB -c "Delete :$k" "$3" 2>/dev/null || true
    done
    $PB -c "Add :application-identifier string $TEAM.$2" \
        -c "Add :com.apple.developer.team-identifier string $TEAM" \
        -c "Add :get-task-allow bool true" \
        -c "Add :keychain-access-groups array" \
        -c "Add :keychain-access-groups:0 string $TEAM.$2" "$3"
}
ENT="$WORK/entitlements.plist"
EXT_ENT="$WORK/ext-entitlements.plist"
entitlements ios/HappyNextdev/HappyNextdev.entitlements "$BUNDLE_ID" "$ENT"
entitlements ios/ShareExtension/ShareExtension.entitlements "$EXT_ID" "$EXT_ENT"

# A Debug build puts the app's own code in HappyNextdev.debug.dylib (and __preview.dylib) next to
# the executable. `codesign --verify --deep` does not count them as nested code, but dyld refuses
# to load them unsigned and the app dies at launch. The extension's Debug build does the same.
# Inside out: the extension's code, the extension, then the app's code and the app.
for f in "$X"/Frameworks/*.framework "$X"/Frameworks/*.dylib "$X"/*.dylib; do
    [ -e "$f" ] || continue
    codesign --force --sign "$IDENTITY" --timestamp=none --preserve-metadata=identifier "$f" > /dev/null 2>&1 \
        || die "codesign failed: $f"
done
cp "$EXT_PROFILE" "$X/embedded.mobileprovision"
codesign --force --sign "$IDENTITY" --timestamp=none --entitlements "$EXT_ENT" "$X" > /dev/null 2>&1 || die "codesign failed: share extension"
for f in "$A"/Frameworks/*.framework "$A"/Frameworks/*.dylib "$A"/*.dylib; do
    [ -e "$f" ] || continue
    codesign --force --sign "$IDENTITY" --timestamp=none --preserve-metadata=identifier "$f" > /dev/null 2>&1 \
        || die "codesign failed: $f"
done
cp "$PROFILE" "$A/embedded.mobileprovision"
codesign --force --sign "$IDENTITY" --timestamp=none --entitlements "$ENT" "$A" > /dev/null 2>&1 || die "codesign failed: app"
codesign --verify --deep --strict "$A" || die "codesign verify failed"

VERSION=$($PB -c 'Print :CFBundleShortVersionString' "$A/Info.plist")
BUILD=$($PB -c 'Print :CFBundleVersion' "$A/Info.plist")
NAME="HappyNextdev-$VERSION-$SHA-$LABEL-$TS.ipa"
(cd "$WORK" && zip -qry "$WORK/$NAME" Payload)

publish_ipa "$WORK/$NAME" "$NAME"
echo "$HEAD_FULL" > "$STATE/dev-commit"

echo "RESULT_MODE=dev (Debug dev client, needs a Metro dev server)"
echo "RESULT_BUNDLE_ID=$($PB -c 'Print :CFBundleIdentifier' "$A/Info.plist")"
echo "RESULT_VERSION=$VERSION ($BUILD)"
echo "RESULT_COMMIT=$SHA"
echo "RESULT_APS=$(codesign -d --entitlements :- "$A" 2>/dev/null | plutil -extract aps-environment raw - 2>/dev/null || echo none)"
echo "RESULT_PROFILE=$($PB -c 'Print :Name' "$WORK/profile.plist"), expires $(plutil -extract ExpirationDate raw "$WORK/profile.plist"), $($PB -c 'Print :ProvisionedDevices' "$WORK/profile.plist" | grep -c '^ ') devices"
echo "RESULT_EXT_PROFILE=$($PB -c 'Print :Name' "$WORK/ext-profile.plist"), expires $(plutil -extract ExpirationDate raw "$WORK/ext-profile.plist"), $($PB -c 'Print :ProvisionedDevices' "$WORK/ext-profile.plist" | grep -c '^ ') devices"
echo "RESULT_SHARE_EXTENSION=$($PB -c 'Print :CFBundleIdentifier' "$X/Info.plist"), app group $(codesign -d --entitlements :- "$X" 2>/dev/null | grep -qF "<string>$APP_GROUP</string>" && echo "$APP_GROUP" || echo NONE)"
echo "RESULT_PREBUILD=$NEED_PREBUILD"

rm -rf "$WORK/Payload" "$WORK/$NAME"
echo "RESULT_LOGS=$WORK"
