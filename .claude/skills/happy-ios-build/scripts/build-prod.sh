#!/bin/bash
# Production (APP_ENV=production, com.hitosea.happy) Ad Hoc IPA with production push and the
# Apple Watch app → appdown. Uses the EXISTING Ad Hoc cert/profiles: the app's and the share
# extension's from EAS, the watch targets' from $WATCH_PROFILES in iCloud Drive (made on the Apple
# Developer portal, as EAS can't put an Apple Watch in a profile); never creates or revokes
# credentials, never builds in the EAS cloud, never submits. Restores the dev native project
# afterwards.
# Usage: build-prod.sh [label]
source "$(dirname "$0")/common.sh"

LABEL=$(slug "${1:-prod}")
BUNDLE_ID=com.hitosea.happy
EXT_ID=$BUNDLE_ID.share-extension   # expo-share-intent's ShareExtension target
APP_GROUP=group.$BUNDLE_ID
WATCH_ID=$BUNDLE_ID.watchkitapp     # @bacons/apple-targets' HappyWatch (targets/watch)
WIDGET_ID=$WATCH_ID.widget          # its complication, HappyWatchWidget (targets/watch-widget)
WATCH_GROUP=group.$BUNDLE_ID.watch
WATCH_PROFILES="$HOME/Library/Mobile Documents/com~apple~CloudDocs/HappyNext/ios"
TMP_PROFILE=production-adhoc
KEYCHAIN=/tmp/happy-build.keychain-db
LOGIN_KC="$HOME/Library/Keychains/login.keychain-db"
SYSTEM_KC=/Library/Keychains/System.keychain
PROFILES_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"

acquire_lock
trap release_lock EXIT

cd "$REPO"
git diff --quiet HEAD || die "tracked files are modified on the Mac mini; sync the repo first"
SHA=$(git rev-parse --short=8 HEAD)
TS=$(date +%Y%m%d-%H%M%S)
WORK=/tmp/happy-prod-$TS
mkdir -p "$WORK"
git status --porcelain -uall > "$WORK/git-before.txt"
echo "commit $SHA, work dir $WORK"
sync_patches "$WORK/patches.log"

cd "$APP"
[ ! -e credentials.json ] && [ ! -e credentials ] || die "credentials.json / credentials/ already exist in $APP; look at them before building"

# --- restore everything on any exit ----------------------------------------------
IOS_MOVED=0; EAS_BACKED=0; KC_MADE=0; PROFILES_INSTALLED=""
cleanup() {
    set +e
    cd "$APP"
    if [ "$IOS_MOVED" = 1 ]; then rm -rf ios; mv "$WORK/ios-dev" ios; fi
    [ "$EAS_BACKED" = 1 ] && cp "$WORK/eas.json" eas.json
    rm -rf credentials.json credentials
    rm -f "$WORK/prod.env" "$WORK/kc-pass"
    for f in $PROFILES_INSTALLED; do rm -f "$f"; done
    if [ "$KC_MADE" = 1 ]; then
        security list-keychains -d user -s "$LOGIN_KC" "$SYSTEM_KC"
        security delete-keychain "$KEYCHAIN"
    fi
    rm -rf "$WORK/HappyNext.xcarchive" "$WORK/export" "$WORK/check"
    cd "$REPO"
    git status --porcelain -uall > "$WORK/git-after.txt"
    if cmp -s "$WORK/git-before.txt" "$WORK/git-after.txt"; then echo "RESULT_REPO=restored"; else
        echo "RESULT_REPO=DIFFERS from before:"; diff "$WORK/git-before.txt" "$WORK/git-after.txt"; fi
    [ -d "$APP/ios/HappyNextdev.xcworkspace" ] && echo "RESULT_DEV_PROJECT=restored" || echo "RESULT_DEV_PROJECT=MISSING"
    release_lock
}
trap cleanup EXIT

# --- 1. back up the dev native project and eas.json ---------------------------------
log "back up ios/ and eas.json"
if [ -d ios ]; then mv ios "$WORK/ios-dev"; IOS_MOVED=1; fi
cp eas.json "$WORK/eas.json"; EAS_BACKED=1

# --- 2. production env from EAS ---------------------------------------------------
log "eas env:pull production"
run_logged "$WORK/env-pull.log" eas env:pull production --path "$WORK/prod.env" --non-interactive
for k in EXPO_PUBLIC_DOOPUSH_APP_ID EXPO_PUBLIC_DOOPUSH_APP_KEY EXPO_PUBLIC_DOOPUSH_BASE_URL; do
    grep -qE "^$k=.+" "$WORK/prod.env" || die "$k missing from the EAS production environment"
done

# --- 3. temporary Ad Hoc build profile, appended last ---------------------------------
ARROWS=$(python3 - "$TMP_PROFILE" <<'EOF'
import json, sys
name = sys.argv[1]
d = json.load(open('eas.json'))
assert name not in d['build'], name + ' already in eas.json'
d['build'][name] = {
    "distribution": "internal",
    "channel": "production",
    "env": {"APP_ENV": "production", "ABI_FILTERS": "arm64-v8a"},
}
with open('eas.json', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(len(d['build']) - 1)
EOF
)

# --- 4-5. download the existing Ad Hoc cert + profiles from EAS -------------------------------
# EAS has one for each of the four targets (it won't download with one missing), but its watch
# targets' list no Apple Watch: those two are replaced by the portal-made ones below.
log "download Ad Hoc credentials from EAS"
ARROWS=$ARROWS PROFILE=$TMP_PROFILE expect "$SCRIPTS/eas-creds.exp" > "$WORK/eas-creds.log" 2>&1 || {
    tail -30 "$WORK/eas-creds.log"
    grep -q EAS_TARGET_ERROR "$WORK/eas-creds.log" \
        && die "a build target has no Ad Hoc credentials on EAS (each of $EXT_ID, $WATCH_ID and $WIDGET_ID needs its own)"
    die "eas credentials download failed"; }
[ -f credentials.json ] || { tail -30 "$WORK/eas-creds.log"; die "eas credentials did not write credentials.json"; }

python3 "$SCRIPTS/adhoc-creds.py" credentials.json > "$WORK/creds.txt" || die "could not read credentials.json"
# creds <bundle id> <field>: 2 profile, 3 p12, 4 p12 password
creds() { awk -v b="$1" -v f="$2" '$1 == b { print $f }' "$WORK/creds.txt"; }
APP_PROFILE_FILE=$(creds "$BUNDLE_ID" 2); EXT_PROFILE_FILE=$(creds "$EXT_ID" 2)
P12=$(creds "$BUNDLE_ID" 3); P12PASS=$(creds "$BUNDLE_ID" 4)
[ -n "$APP_PROFILE_FILE" ] && [ -f "$P12" ] || die "credentials.json has no Ad Hoc profile + certificate for $BUNDLE_ID"
[ -n "$EXT_PROFILE_FILE" ] || die "credentials.json has no Ad Hoc profile for $EXT_ID (set up the share extension's credentials on EAS)"
# The watch targets' Ad Hoc profiles, with the Apple Watch among their devices
WATCH_PROFILE_FILE=$(python3 "$SCRIPTS/local-profile.py" "$WATCH_PROFILES" "$WATCH_ID" "$P12" "$P12PASS") \
    || die "no Ad Hoc profile for $WATCH_ID in $WATCH_PROFILES signing with the EAS distribution certificate (make one on the Apple Developer portal with the watch among its devices)"
WIDGET_PROFILE_FILE=$(python3 "$SCRIPTS/local-profile.py" "$WATCH_PROFILES" "$WIDGET_ID" "$P12" "$P12PASS") \
    || die "no Ad Hoc profile for $WIDGET_ID in $WATCH_PROFILES signing with the EAS distribution certificate (make one on the Apple Developer portal with the watch among its devices)"

security cms -D -i "$APP_PROFILE_FILE" > "$WORK/profile.plist"
security cms -D -i "$EXT_PROFILE_FILE" > "$WORK/ext-profile.plist"
PROFILE_UUID=$($PB -c 'Print :UUID' "$WORK/profile.plist")
PROFILE_NAME=$($PB -c 'Print :Name' "$WORK/profile.plist")
PROFILE_EXP=$(plutil -extract ExpirationDate raw "$WORK/profile.plist")
EXT_PROFILE_UUID=$($PB -c 'Print :UUID' "$WORK/ext-profile.plist")
EXT_PROFILE_NAME=$($PB -c 'Print :Name' "$WORK/ext-profile.plist")
EXT_PROFILE_EXP=$(plutil -extract ExpirationDate raw "$WORK/ext-profile.plist")
security cms -D -i "$WATCH_PROFILE_FILE" > "$WORK/watch-profile.plist"
security cms -D -i "$WIDGET_PROFILE_FILE" > "$WORK/widget-profile.plist"
WATCH_PROFILE_UUID=$($PB -c 'Print :UUID' "$WORK/watch-profile.plist")
WATCH_PROFILE_NAME=$($PB -c 'Print :Name' "$WORK/watch-profile.plist")
WATCH_PROFILE_EXP=$(plutil -extract ExpirationDate raw "$WORK/watch-profile.plist")
WIDGET_PROFILE_UUID=$($PB -c 'Print :UUID' "$WORK/widget-profile.plist")
WIDGET_PROFILE_NAME=$($PB -c 'Print :Name' "$WORK/widget-profile.plist")
WIDGET_PROFILE_EXP=$(plutil -extract ExpirationDate raw "$WORK/widget-profile.plist")
[ "$($PB -c 'Print :Entitlements:aps-environment' "$WORK/profile.plist")" = production ] || die "profile has no production push"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[[ "$PROFILE_EXP" > "$NOW" ]] || die "Ad Hoc profile expired on $PROFILE_EXP"
[[ "$EXT_PROFILE_EXP" > "$NOW" ]] || die "share extension's Ad Hoc profile expired on $EXT_PROFILE_EXP"
# The share extension hands what was shared to the app through the App Group
for f in "$WORK/profile.plist" "$WORK/ext-profile.plist"; do
    $PB -c 'Print :Entitlements:com.apple.security.application-groups' "$f" 2>/dev/null | grep -qx "    $APP_GROUP" \
        || die "$($PB -c 'Print :Name' "$f") lacks the App Group $APP_GROUP (regenerate it on EAS once the App ID has it)"
done
# Both targets' profiles must list the same devices, or the IPA won't install where only one does
devices() { $PB -c 'Print :ProvisionedDevices' "$1" | grep '^ ' | tr -d ' ' | sort; }
cmp -s <(devices "$WORK/profile.plist") <(devices "$WORK/ext-profile.plist") \
    || die "the app's and the share extension's Ad Hoc profiles list different devices"
# The watch app and its complication share a group of their own, and the same devices
for f in "$WORK/watch-profile.plist" "$WORK/widget-profile.plist"; do
    $PB -c 'Print :Entitlements:com.apple.security.application-groups' "$f" 2>/dev/null | grep -qx "    $WATCH_GROUP" \
        || die "$($PB -c 'Print :Name' "$f") lacks the App Group $WATCH_GROUP"
done
cmp -s <(devices "$WORK/watch-profile.plist") <(devices "$WORK/widget-profile.plist") \
    || die "the watch app's and its complication's Ad Hoc profiles list different devices"
# The watches: in the watch profiles but not among the phones the app's profile lists
WATCHES=$(comm -13 <(devices "$WORK/profile.plist") <(devices "$WORK/watch-profile.plist") | tr '\n' ' ')
[ -n "$WATCHES" ] || die "$WATCH_PROFILE_NAME lists no device besides the app's phones, so no Apple Watch could install the watch app"

# --- 6. temporary keychain with the cert and the WWDR G3 intermediate -----------------------
log "temporary keychain"
openssl rand -base64 24 > "$WORK/kc-pass"; chmod 600 "$WORK/kc-pass"
KP=$(cat "$WORK/kc-pass")
security delete-keychain "$KEYCHAIN" 2>/dev/null || true
security create-keychain -p "$KP" "$KEYCHAIN"; KC_MADE=1
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KP" "$KEYCHAIN"
security import "$P12" -k "$KEYCHAIN" -P "$P12PASS" -T /usr/bin/codesign -T /usr/bin/security > /dev/null
# The Mac mini only has the expired WWDR G1; the distribution cert chains to G3.
curl -fsSL https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer -o "$WORK/wwdrg3.cer"
security import "$WORK/wwdrg3.cer" -k "$KEYCHAIN" -T /usr/bin/codesign -T /usr/bin/security > /dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KP" "$KEYCHAIN" > /dev/null
# Fixed paths: parsing `security list-keychains` output corrupts entries.
security list-keychains -d user -s "$LOGIN_KC" "$KEYCHAIN" "$SYSTEM_KC"
SIGN_ID=$(security find-identity -v -p codesigning "$KEYCHAIN" | awk -F'"' '/Distribution/ {print $2; exit}')
[ -n "$SIGN_ID" ] || die "no valid distribution identity in the temporary keychain"

mkdir -p "$PROFILES_DIR"
for pair in "$PROFILE_UUID:$APP_PROFILE_FILE" "$EXT_PROFILE_UUID:$EXT_PROFILE_FILE" \
    "$WATCH_PROFILE_UUID:$WATCH_PROFILE_FILE" "$WIDGET_PROFILE_UUID:$WIDGET_PROFILE_FILE"; do
    uuid=${pair%%:*}; file=${pair#*:}
    [ -f "$PROFILES_DIR/$uuid.mobileprovision" ] && continue
    cp "$file" "$PROFILES_DIR/$uuid.mobileprovision"
    PROFILES_INSTALLED="$PROFILES_INSTALLED $PROFILES_DIR/$uuid.mobileprovision"
done

# --- 7. production prebuild ---------------------------------------------------------------
# APP_ENV is not in prod.env (it comes from the eas.json profile). Don't run yarn install here.
log "APP_ENV=production expo prebuild --clean"
prod_env() { set -a; . "$WORK/prod.env"; set +a; export APP_ENV=production NODE_ENV=production CI=1; }
( prod_env; run_logged "$WORK/prebuild.log" npx expo prebuild -p ios --clean )
[ -d ios/HappyNext.xcworkspace ] || die "prebuild did not produce ios/HappyNext.xcworkspace"
[ -f ios/ShareExtension/ShareExtension.entitlements ] || die "prebuild did not produce the ShareExtension target"
# Each target signs with its own profile, so the profiles go into the targets' build settings
# rather than onto the xcodebuild command line.
python3 "$SCRIPTS/set-profiles.py" ios/HappyNext.xcodeproj/project.pbxproj \
    "$BUNDLE_ID=$PROFILE_UUID" "$EXT_ID=$EXT_PROFILE_UUID" \
    "$WATCH_ID=$WATCH_PROFILE_UUID" "$WIDGET_ID=$WIDGET_PROFILE_UUID" || die "could not set the targets' provisioning profiles"

# --- 8. build number: max(EAS remote, last local IPA, last recorded) + 1 -----------------------
# Expo's Info.plist hardcodes CFBundleVersion=1 and CURRENT_PROJECT_VERSION doesn't override it.
REMOTE=$(eas build:version:get --platform ios < /dev/null 2>/dev/null | grep -oE '[0-9]+$' | tail -1 || true)
LOCAL=$(ls "$BUILDS" 2>/dev/null | sed -nE 's/^HappyNext-[0-9.]+-([0-9]+)-.*\.ipa$/\1/p' | sort -n | tail -1)
RECORDED=$(cat "$STATE/prod-build-number" 2>/dev/null || true)
BUILD=$(printf '%s\n' "${REMOTE:-0}" "${LOCAL:-0}" "${RECORDED:-0}" | sort -n | tail -1)
BUILD=$((BUILD + 1))
plutil -replace CFBundleVersion -string "$BUILD" ios/HappyNext/Info.plist
VERSION=$($PB -c 'Print :CFBundleShortVersionString' ios/HappyNext/Info.plist)
echo "version $VERSION, build $BUILD (EAS ${REMOTE:-?}, local ${LOCAL:-none}, recorded ${RECORDED:-none})"

# --- 9. archive (EXPO_PUBLIC_* get inlined while bundling here, so prod env again) ------------------
log "xcodebuild archive (takes ~10 min)"
( prod_env; run_logged "$WORK/archive.log" xcodebuild \
    -workspace ios/HappyNext.xcworkspace -scheme HappyNext -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$WORK/HappyNext.xcarchive" \
    DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$SIGN_ID" \
    CURRENT_PROJECT_VERSION="$BUILD" \
    OTHER_CODE_SIGN_FLAGS="--keychain $KEYCHAIN" archive )
[ "$($PB -c 'Print :ApplicationProperties:CFBundleVersion' "$WORK/HappyNext.xcarchive/Info.plist")" = "$BUILD" ] \
    || die "archive has the wrong CFBundleVersion"

# --- 10. export ----------------------------------------------------------------------------
log "exportArchive (release-testing)"
cat > "$WORK/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>release-testing</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingCertificate</key><string>$SIGN_ID</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>$BUNDLE_ID</key><string>$PROFILE_NAME</string>
    <key>$EXT_ID</key><string>$EXT_PROFILE_NAME</string>
    <key>$WATCH_ID</key><string>$WATCH_PROFILE_NAME</string>
    <key>$WIDGET_ID</key><string>$WIDGET_PROFILE_NAME</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>stripSwiftSymbols</key><true/>
  <key>compileBitcode</key><false/>
</dict>
</plist>
EOF
# "missing Xcode-Username" in this log is harmless with manual signing.
run_logged "$WORK/export.log" xcodebuild -exportArchive -archivePath "$WORK/HappyNext.xcarchive" \
    -exportPath "$WORK/export" -exportOptionsPlist "$WORK/ExportOptions.plist"

# --- 11. verify the IPA ------------------------------------------------------------------------
log "verify"
mkdir -p "$WORK/check"
unzip -q "$WORK/export/HappyNext.ipa" -d "$WORK/check"
A="$WORK/check/Payload/HappyNext.app"
codesign --verify --deep --strict "$A" || die "codesign verify failed"
APS=$(codesign -d --entitlements :- "$A" 2>/dev/null | plutil -extract aps-environment raw - 2>/dev/null || true)
[ "$APS" = production ] || die "aps-environment is '$APS', not production"
[ "$($PB -c 'Print :CFBundleIdentifier' "$A/Info.plist")" = "$BUNDLE_ID" ] || die "wrong bundle id"
X="$A/PlugIns/ShareExtension.appex"
[ -d "$X" ] || die "the IPA has no share extension"
[ "$($PB -c 'Print :CFBundleIdentifier' "$X/Info.plist")" = "$EXT_ID" ] || die "share extension has the wrong bundle id"
[ "$($PB -c 'Print :CFBundleVersion' "$X/Info.plist")" = "$BUILD" ] || die "share extension's CFBundleVersion differs from the app's"
for b in "$A" "$X"; do
    # plutil -extract can't read this key: it takes the dots in its name for a key path
    codesign -d --entitlements :- "$b" 2>/dev/null | grep -qF "<string>$APP_GROUP</string>" \
        || die "$(basename "$b") is not signed with the App Group $APP_GROUP"
done
W="$A/Watch/HappyWatch.app"
WX="$W/PlugIns/HappyWatchWidget.appex"
[ -d "$W" ] && [ -d "$WX" ] || die "the IPA has no watch app or no complication"
for pair in "$W:$WATCH_ID" "$WX:$WIDGET_ID"; do
    b=${pair%%:*}; id=${pair#*:}
    [ "$($PB -c 'Print :CFBundleIdentifier' "$b/Info.plist")" = "$id" ] || die "$(basename "$b") has the wrong bundle id"
    [ "$($PB -c 'Print :CFBundleVersion' "$b/Info.plist")" = "$BUILD" ] || die "$(basename "$b")'s CFBundleVersion differs from the app's"
    [ "$($PB -c 'Print :CFBundleShortVersionString' "$b/Info.plist")" = "$VERSION" ] || die "$(basename "$b")'s version differs from the app's"
    codesign -d --entitlements :- "$b" 2>/dev/null | grep -qF "<string>$WATCH_GROUP</string>" \
        || die "$(basename "$b") is not signed with the App Group $WATCH_GROUP"
done
python3 - "$WORK/prod.env" "$A/EXConstants.bundle/app.config" <<'EOF' || die "DooPush config in the IPA doesn't match the EAS production environment"
import json, sys
env = {}
for line in open(sys.argv[1]):
    if '=' in line and not line.startswith('#'):
        k, _, v = line.rstrip('\n').partition('=')
        env[k] = v.strip('"')
d = (json.load(open(sys.argv[2])).get('extra') or {}).get('doopush') or {}
ok = d.get('appId') == env.get('EXPO_PUBLIC_DOOPUSH_APP_ID') and d.get('appKey') == env.get('EXPO_PUBLIC_DOOPUSH_APP_KEY')
print('RESULT_DOOPUSH=' + ('match, ' if ok else 'MISMATCH, ') + str(d.get('baseURL')))
sys.exit(0 if ok else 1)
EOF

NAME="HappyNext-$VERSION-$BUILD-$SHA-$LABEL-$TS.ipa"
publish_ipa "$WORK/export/HappyNext.ipa" "$NAME"
echo "$BUILD" > "$STATE/prod-build-number"

echo "RESULT_MODE=prod (Ad Hoc, production push, with the watch app)"
echo "RESULT_BUNDLE_ID=$BUNDLE_ID"
echo "RESULT_VERSION=$VERSION ($BUILD)"
echo "RESULT_COMMIT=$SHA"
echo "RESULT_APS=$APS"
echo "RESULT_PROFILE=$PROFILE_NAME, expires $PROFILE_EXP"
echo "RESULT_EXT_PROFILE=$EXT_PROFILE_NAME, expires $EXT_PROFILE_EXP"
echo "RESULT_WATCH_PROFILE=$WATCH_PROFILE_NAME, expires $WATCH_PROFILE_EXP"
echo "RESULT_WIDGET_PROFILE=$WIDGET_PROFILE_NAME, expires $WIDGET_PROFILE_EXP"
echo "RESULT_SHARE_EXTENSION=$EXT_ID, app group $APP_GROUP"
echo "RESULT_WATCH_APP=$WATCH_ID + $WIDGET_ID, app group $WATCH_GROUP"
echo "RESULT_DEVICES=$(devices "$WORK/profile.plist" | tr '\n' ' ')"
echo "RESULT_WATCHES=$WATCHES"
echo "RESULT_LOGS=$WORK"
