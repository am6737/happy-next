import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { resolveCodexRuntime } from '@/codex/codexRuntime';
import { codexPackage } from '@/codex/package';
import { getCodexHomeDir } from '@/codex/utils/codexHome';
import { logger } from '@/ui/logger';

/** User config tables that describe the owner's own projects, servers and UI rather than the model setup. */
const PRIVATE_CODEX_TABLES = /^(projects|mcp_servers|tui)(\.|$)/;

const GIT_HOOKS = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg',
    'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'post-rewrite', 'pre-auto-gc', 'post-index-change'];

/** Owner-only GitHub actions; the same list feeds the gh shim and Codex's command rules. */
const GH_DENIED = [['pr', 'merge'], ['pr', 'ready'], ['repo', 'delete']];

const GH_SHIM = `#!/bin/sh
# Happy teammate guard: merging, marking PRs ready and deleting repositories are left to the owner.
deny() { echo "happy: '$1' is reserved for the owner; leave the PR for them to merge or mark ready." >&2; exit 1; }
case "$1 $2" in ${GH_DENIED.map(words => `"${words.join(' ')}"`).join('|')}) deny "gh $1 $2" ;; esac
if [ "$1" = api ]; then
  for arg; do
    case "$arg" in */merge|*/merge\\?*|*/merges|*mergePullRequest*|*markPullRequestReadyForReview*|*enablePullRequestAutoMerge*) deny "gh api $arg" ;; esac
  done
fi
self=$(cd "$(dirname "$0")" && pwd -P)
IFS=:
for dir in $PATH; do
  [ -n "$dir" ] && [ "$(cd "$dir" 2>/dev/null && pwd -P)" != "$self" ] && [ -x "$dir/gh" ] && exec "$dir/gh" "$@"
done
echo "gh: command not found" >&2
exit 127
`;

const GIT_HOOK = `#!/bin/sh
# Happy teammate guard: refuse pushes to the default branch, then run the repository's own hook.
hook=$(basename "$0")
if [ "$hook" = pre-push ]; then
  input=$(cat)
  default=$(git symbolic-ref --quiet --short "refs/remotes/$1/HEAD" 2>/dev/null)
  default=\${default#"$1"/}
  protected=\${default:+refs/heads/$default}
  printf '%s\\n' "$input" | while read -r local_ref local_sha remote_ref remote_sha; do
    case "$remote_ref" in "\${protected:-refs/heads/main}"|"\${protected:-refs/heads/master}")
      echo "happy: pushing to the default branch is reserved for the owner; push a feature branch and open a PR." >&2; exit 1 ;;
    esac
  done || exit 1
fi
dir=$(git config --local --get core.hooksPath 2>/dev/null)
case "$dir" in "") dir="$(git rev-parse --git-common-dir)/hooks" ;; /*) ;; *) dir="$(git rev-parse --show-toplevel)/$dir" ;; esac
[ -x "$dir/$hook" ] || exit 0
[ "$hook" = pre-push ] || exec "$dir/$hook" "$@"
if [ -n "$input" ]; then printf '%s\\n' "$input"; fi | "$dir/$hook" "$@"
`;

/**
 * Per-agent guard rails, rewritten on each spawn: a gh shim first on PATH and git hooks that block pushes to the default branch.
 * Codex agents also get their own CODEX_HOME, so rollouts, trust entries and the owner's MCP servers stay apart.
 */
export async function prepareTeammateIsolation(home: string, provider: string, userCodexHome = getCodexHomeDir()): Promise<{
    env: Record<string, string>; hooksPath: string; codexHome?: string;
}> {
    const state = join(home, 'state');
    const binDir = join(state, 'bin');
    const hooksPath = join(state, 'githooks');
    await mkdir(binDir, { recursive: true, mode: 0o700 });
    await mkdir(hooksPath, { recursive: true, mode: 0o700 });
    // Controllers and workers of one agent spawn concurrently; replace files atomically so none sees a half-written one.
    const put = async (path: string, write: (temp: string) => Promise<void>) => {
        const temp = `${path}.${randomUUID()}`;
        await write(temp);
        await rename(temp, path);
    };
    await put(join(binDir, 'gh'), temp => writeFile(temp, GH_SHIM, { mode: 0o700 }));
    await Promise.all(GIT_HOOKS.map(hook => put(join(hooksPath, hook), temp => writeFile(temp, GIT_HOOK, { mode: 0o700 }))));
    const env: Record<string, string> = { PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter) };
    if (provider !== 'codex') return { env, hooksPath };

    const codexHome = join(state, 'codex');
    await mkdir(join(codexHome, 'rules'), { recursive: true, mode: 0o700 });
    // Link rather than copy so a refreshed login stays shared with the owner's Codex.
    await put(join(codexHome, 'auth.json'), temp => symlink(join(userCodexHome, 'auth.json'), temp));
    const userConfig = await readFile(join(userCodexHome, 'config.toml'), 'utf8').catch(() => '');
    let table = '';
    const kept = userConfig.split('\n').filter(line => {
        const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
        if (header) table = header[1];
        return table ? !PRIVATE_CODEX_TABLES.test(table) : !/^\s*allow_login_shell\s*=/.test(line);
    });
    // A login shell re-reads the profile, which can put another gh ahead of the shim.
    await put(join(codexHome, 'config.toml'), temp => writeFile(temp, ['allow_login_shell = false', ...kept].join('\n'), { mode: 0o600 }));
    await put(join(codexHome, 'rules', 'teammate.rules'), temp => writeFile(temp,
        GH_DENIED.map(words => `prefix_rule(pattern=${JSON.stringify(['gh', ...words])}, decision="forbidden")\n`).join(''), { mode: 0o600 }));
    return { env: { ...env, CODEX_HOME: codexHome }, hooksPath, codexHome };
}

let sandboxProbe: Promise<boolean> | undefined;

/**
 * Whether Codex can sandbox commands on this machine. Linux needs bubblewrap with network namespaces, which many
 * containers deny; a read-only worker there could not run a single command, so it keeps its normal mode instead.
 */
export function codexSandboxWorks(): Promise<boolean> {
    const platform = ({ linux: 'linux', darwin: 'macos', win32: 'windows' } as Record<string, string>)[process.platform];
    sandboxProbe ??= platform ? (async () => {
        const runtime = resolveCodexRuntime(codexPackage(), ['sandbox', platform, '--', 'true']);
        return promisify(execFile)(runtime.command, runtime.args, { timeout: 120_000 }).then(() => true, error => {
            logger.warn(`[TEAMMATE] Codex sandbox unavailable, review workers keep their permission mode: ${String(error.stderr ?? error).trim().split('\n').pop()}`);
            return false;
        });
    })() : Promise.resolve(false);
    return sandboxProbe;
}
