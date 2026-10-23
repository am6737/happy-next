# Shared helpers for build-dev.sh / build-prod.sh. Runs on the Mac mini under bash 3.2.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPTS/../../../.." && pwd)"
APP="$REPO/packages/happy-app"
BUILDS="$HOME/wwwroot/appdown/builds"
APPDOWN_URL="https://8083-weiyi.dootask.com"
STATE="$HOME/.happy-ios-build"
TEAM=G365J5PZA2
PB=/usr/libexec/PlistBuddy

mkdir -p "$STATE"

log() { printf '\n== %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

slug() {
    local s
    s=$(printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-' | tr -s '-' | sed 's/^-//; s/-$//' | cut -c1-24)
    printf '%s' "${s:-build}"
}

# Only one build at a time: the prod build moves ios/ away, the dev build uses it.
acquire_lock() {
    mkdir "$STATE/lock" 2>/dev/null || die "another build holds $STATE/lock (remove it only if no build is running)"
}
release_lock() { rmdir "$STATE/lock" 2>/dev/null || true; }

# Runs a long command with its output in a log; on failure prints the errors and the tail.
run_logged() {
    local logfile="$1"; shift
    if ! "$@" > "$logfile" 2>&1; then
        grep -nE 'error:|ERROR|FAILED|Error:' "$logfile" | tail -20 || true
        echo '-- log tail --'; tail -30 "$logfile"
        die "command failed: $* (log: $logfile)"
    fi
}

# Newest unexpired installed profile with this exact Name.
find_profile() {
    local want="$1" best="" bestexp="" now tmp f exp d
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    tmp=$(mktemp)
    for d in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
        [ -d "$d" ] || continue
        for f in "$d"/*.mobileprovision; do
            [ -f "$f" ] || continue
            security cms -D -i "$f" > "$tmp" 2>/dev/null || continue
            [ "$($PB -c 'Print :Name' "$tmp" 2>/dev/null)" = "$want" ] || continue
            exp=$(plutil -extract ExpirationDate raw "$tmp")
            if [[ "$exp" > "$now" && "$exp" > "$bestexp" ]]; then best="$f"; bestexp="$exp"; fi
        done
    done
    rm -f "$tmp"
    printf '%s' "$best"
}

# Copies the IPA into appdown and checks the page lists it. Prints RESULT_ lines.
publish_ipa() {
    local src="$1" name="$2" base
    base="${name%.ipa}"
    cp "$src" "$BUILDS/$name"
    echo "RESULT_IPA=$BUILDS/$name"
    echo "RESULT_SIZE=$(stat -f %z "$BUILDS/$name")"
    echo "RESULT_SHA256=$(shasum -a 256 "$BUILDS/$name" | cut -d' ' -f1)"
    # appdown routes use the file name without .ipa
    if curl -fsS --max-time 30 "$APPDOWN_URL/?platform=all" | grep -q "$base"; then
        echo "RESULT_PAGE=listed"
    else
        echo "RESULT_PAGE=NOT listed (is appdown / its tunnel up?)"
    fi
    echo "RESULT_INSTALL_URL=$APPDOWN_URL/?platform=ios"
}

# patch-package applies a patch only to the package as installed: a changed patch fails on top of
# its old version, and yarn install runs only when yarn.lock changes. So the commit whose patches
# node_modules carries is kept in $STATE/patches-commit; each patch changed since is taken back in
# its old version, and patch-package applies what HEAD has. Patches live in patches/ (applied at the
# repo root) and packages/happy-app/patches/ (applied in the app). Run in $REPO.
sync_patches() {
    local logfile="$1" prev changed f dir
    prev=$(cat "$STATE/patches-commit" 2>/dev/null || cat "$STATE/dev-commit" 2>/dev/null || true)
    [ -n "$prev" ] && git cat-file -e "$prev^{commit}" 2>/dev/null \
        || die "no record of the patches in node_modules; delete $STATE/yarn.lock.sha so the dev build runs yarn install"
    changed=$(git diff --name-only "$prev" HEAD -- patches packages/happy-app/patches)
    if [ -n "$changed" ]; then
        log "patches changed → re-apply"
        for f in $changed; do
            dir="$REPO/$(dirname "$(dirname "$f")")"
            if git cat-file -e "$prev:$f" 2>/dev/null; then
                git show "$prev:$f" | patch -p1 -R -s -f -d "$dir" > /dev/null || die "could not take back the old $f"
            fi
        done
        (cd "$REPO" && run_logged "$logfile" npx patch-package)
        (cd "$APP" && run_logged "$logfile.app" npx patch-package)
    fi
    git rev-parse HEAD > "$STATE/patches-commit"
}
