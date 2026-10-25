#!/usr/bin/env bash
# Prints the runtime version (native fingerprint) a build was made with: the one OTA updates must
# carry to reach it. Usage: embedded-fingerprint.sh <app.ipa|app.apk|app.aab>
set -euo pipefail
file=${1:?usage: embedded-fingerprint.sh <ipa|apk|aab>}
case "$file" in
    *.ipa) pattern='Payload/*.app/EXUpdates.bundle/fingerprint' ;;
    *.apk) pattern='assets/fingerprint' ;;
    *.aab) pattern='base/assets/fingerprint' ;;
    *) echo "unknown file type: $file" >&2; exit 1 ;;
esac
value=$(unzip -p "$file" "$pattern" 2>/dev/null || true)
if [ -z "$value" ]; then
    # Builds from before the fingerprint policy carry a fixed runtime version in their config
    echo "no embedded fingerprint in $file (built before runtimeVersion became the fingerprint?)" >&2
    exit 2
fi
echo "$value"
