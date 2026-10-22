#!/bin/bash
# Production (APP_ENV=production, com.hitosea.happy) Ad Hoc IPA with production push → appdown.
# Uses the EXISTING Ad Hoc cert/profile on EAS; never creates or revokes credentials,
# never builds in the EAS cloud, never submits. Restores the dev native project afterwards.
# Usage: build-prod.sh [label]
source "$(dirname "$0")/common.sh"

LABEL=$(slug "${1:-prod}")
BUNDLE_ID=com.hitosea.happy
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

cd "$APP"
[ ! -e credentials.json ] && [ ! -e credentials ] || die "credentials.json / credentials/ already exist in $APP; look at them before building"

# --- restore everything on any exit ----------------------------------------------
IOS_MOVED=0; WATCH_MOVED=""; EAS_BACKED=0; KC_MADE=0; PROFILE_INSTALLED=""
cleanup() {
    set +e
    cd "$APP"
    if [ "$IOS_MOVED" = 1 ]; then rm -rf ios; mv "$WORK/ios-dev" ios; fi
    for t in $WATCH_MOVED; do mv "$WORK/targets/$t" "targets/$t"; done
    [ "$EAS_BACKED" = 1 ] && cp "$WORK/eas.json" eas.json
    rm -rf credentials.json credentials
    rm -f "$WORK/prod.env" "$WORK/kc-pass"
    [ -n "$PROFILE_INSTALLED" ] && rm -f "$PROFILE_INSTALLED"
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

# --- 4. watch targets have no Ad Hoc credentials: move them out --------------------------
mkdir -p "$WORK/targets"
for t in $(ls targets 2>/dev/null | grep -i watch || true); do
    mv "targets/$t" "$WORK/targets/$t"; WATCH_MOVED="$WATCH_MOVED $t"
done

# --- 5. download the existing Ad Hoc cert + profile ---------------------------------------
log "download Ad Hoc credentials from EAS"
ARROWS=$ARROWS expect "$SCRIPTS/eas-creds.exp" > "$WORK/eas-creds.log" 2>&1 || {
    tail -30 "$WORK/eas-creds.log"; die "eas credentials download failed"; }
[ -f credentials.json ] && [ -f credentials/ios/dist-cert.p12 ] && [ -f credentials/ios/profile.mobileprovision ] || {
    tail -30 "$WORK/eas-creds.log"; die "eas credentials did not write credentials.json + credentials/ios/*"; }

security cms -D -i credentials/ios/profile.mobileprovision > "$WORK/profile.plist"
PROFILE_UUID=$($PB -c 'Print :UUID' "$WORK/profile.plist")
PROFILE_NAME=$($PB -c 'Print :Name' "$WORK/profile.plist")
PROFILE_EXP=$(plutil -extract ExpirationDate raw "$WORK/profile.plist")
[ "$($PB -c 'Print :Entitlements:application-identifier' "$WORK/profile.plist")" = "$TEAM.$BUNDLE_ID" ] || die "profile is not for $BUNDLE_ID"
[ "$($PB -c 'Print :Entitlements:aps-environment' "$WORK/profile.plist")" = production ] || die "profile has no production push"
[[ "$PROFILE_EXP" > "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ]] || die "Ad Hoc profile expired on $PROFILE_EXP"

# --- 6. temporary keychain with the cert and the WWDR G3 intermediate -----------------------
log "temporary keychain"
openssl rand -base64 24 > "$WORK/kc-pass"; chmod 600 "$WORK/kc-pass"
KP=$(cat "$WORK/kc-pass")
security delete-keychain "$KEYCHAIN" 2>/dev/null || true
security create-keychain -p "$KP" "$KEYCHAIN"; KC_MADE=1
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KP" "$KEYCHAIN"
P12PASS=$(python3 -c "import json;print(json.load(open('credentials.json'))['ios']['distributionCertificate']['password'])")
security import credentials/ios/dist-cert.p12 -k "$KEYCHAIN" -P "$P12PASS" -T /usr/bin/codesign -T /usr/bin/security > /dev/null
# The Mac mini only has the expired WWDR G1; the distribution cert chains to G3.
curl -fsSL https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer -o "$WORK/wwdrg3.cer"
security import "$WORK/wwdrg3.cer" -k "$KEYCHAIN" -T /usr/bin/codesign -T /usr/bin/security > /dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KP" "$KEYCHAIN" > /dev/null
# Fixed paths: parsing `security list-keychains` output corrupts entries.
security list-keychains -d user -s "$LOGIN_KC" "$KEYCHAIN" "$SYSTEM_KC"
SIGN_ID=$(security find-identity -v -p codesigning "$KEYCHAIN" | awk -F'"' '/Distribution/ {print $2; exit}')
[ -n "$SIGN_ID" ] || die "no valid distribution identity in the temporary keychain"

if [ ! -f "$PROFILES_DIR/$PROFILE_UUID.mobileprovision" ]; then
    mkdir -p "$PROFILES_DIR"
    cp credentials/ios/profile.mobileprovision "$PROFILES_DIR/$PROFILE_UUID.mobileprovision"
    PROFILE_INSTALLED="$PROFILES_DIR/$PROFILE_UUID.mobileprovision"
fi

# --- 7. production prebuild ---------------------------------------------------------------
# APP_ENV is not in prod.env (it comes from the eas.json profile). Don't run yarn install here.
log "APP_ENV=production expo prebuild --clean"
prod_env() { set -a; . "$WORK/prod.env"; set +a; export APP_ENV=production NODE_ENV=production CI=1; }
( prod_env; run_logged "$WORK/prebuild.log" npx expo prebuild -p ios --clean )
[ -d ios/HappyNext.xcworkspace ] || die "prebuild did not produce ios/HappyNext.xcworkspace"

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
    PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" CURRENT_PROJECT_VERSION="$BUILD" \
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
  <dict><key>$BUNDLE_ID</key><string>$PROFILE_NAME</string></dict>
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

echo "RESULT_MODE=prod (Ad Hoc, production push, no watch app)"
echo "RESULT_BUNDLE_ID=$BUNDLE_ID"
echo "RESULT_VERSION=$VERSION ($BUILD)"
echo "RESULT_COMMIT=$SHA"
echo "RESULT_APS=$APS"
echo "RESULT_PROFILE=$PROFILE_NAME, expires $PROFILE_EXP"
echo "RESULT_DEVICES=$($PB -c 'Print :ProvisionedDevices' "$WORK/profile.plist" | grep '^ ' | tr -d ' ' | tr '\n' ' ')"
echo "RESULT_LOGS=$WORK"
