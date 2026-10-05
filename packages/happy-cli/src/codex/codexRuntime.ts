/**
 * Codex runtime resolution
 *
 * Happy pins one Codex version, but the pinned version does not have to be fetched through
 * `npx` every time: a matching binary on PATH is the same runtime without the download, and
 * a cold `npx` install is what makes the first session after a version bump slow.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

export interface CodexRuntime {
  command: string;
  args: string[];
}

const DEFAULT_INITIALIZE_TIMEOUT_MS = 5 * 60_000;

/**
 * The `initialize` handshake doubles as the cold-start budget: it is the first request a
 * freshly spawned Codex answers, and a cold `npx` fetch of the pinned version can take
 * minutes on a slow machine.
 */
const configuredInitializeTimeout = Number(process.env.HAPPY_CODEX_INIT_TIMEOUT_MS);
export const CODEX_INITIALIZE_TIMEOUT_MS = Number.isFinite(configuredInitializeTimeout) && configuredInitializeTimeout > 0
  ? configuredInitializeTimeout
  : DEFAULT_INITIALIZE_TIMEOUT_MS;

const EXACT_VERSION_SPEC = /^(@?[^@/]+(?:\/[^@]+)?)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;
const CODEX_VERSION_OUTPUT = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/;

let cachedLocalVersion: string | null | undefined;

/** Version pinned by a package spec, or null when it is a range/dist-tag we cannot match. */
export function codexPackageVersion(packageSpec: string): string | null {
  return packageSpec.match(EXACT_VERSION_SPEC)?.[2] ?? null;
}

/** Version of the `codex` on PATH, or null when there is none. */
export function localCodexVersion(): string | null {
  if (cachedLocalVersion !== undefined) return cachedLocalVersion;
  cachedLocalVersion = null;
  // Windows installs are `.cmd` shims, which spawn() refuses without a shell.
  if (process.platform !== 'win32') {
    try {
      const output = execSync('codex --version', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      cachedLocalVersion = output.match(CODEX_VERSION_OUTPUT)?.[1] ?? null;
    } catch {
      // No local Codex — the pinned package comes from npx instead.
    }
  }
  return cachedLocalVersion;
}

/**
 * A local binary is only trusted when it is the exact pinned version; anything else may
 * speak an older app-server protocol, so the pin still wins.
 */
export function pickCodexRuntime(packageSpec: string, args: readonly string[], localVersion: string | null): CodexRuntime {
  const pinnedVersion = codexPackageVersion(packageSpec);
  return pinnedVersion !== null && pinnedVersion === localVersion
    ? { command: 'codex', args: [...args] }
    : { command: 'npx', args: ['-y', packageSpec, ...args] };
}

export function resolveCodexRuntime(packageSpec: string, args: readonly string[]): CodexRuntime {
  const runtime = pickCodexRuntime(packageSpec, args, localCodexVersion());
  logger.debug(`[Codex] Runtime for ${packageSpec}: ${runtime.command} ${runtime.args.join(' ')}`);
  return runtime;
}

/** Whether the pinned version is already on this machine, so starting it needs no download. */
export function isCodexRuntimeWarm(packageSpec: string): boolean {
  const version = codexPackageVersion(packageSpec);
  if (version === null) return false;
  if (pickCodexRuntime(packageSpec, [], localCodexVersion()).command === 'codex') return true;
  return isVersionInNpxCache(version);
}

function isVersionInNpxCache(version: string): boolean {
  const cacheRoot = join(process.env.npm_config_cache ?? join(homedir(), '.npm'), '_npx');
  try {
    return readdirSync(cacheRoot, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && readCachedCodexVersion(join(cacheRoot, entry.name)) === version);
  } catch {
    return false; // No npx cache on this machine
  }
}

function readCachedCodexVersion(npxDir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(npxDir, 'node_modules', '@openai', 'codex', 'package.json'), 'utf-8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null; // Half-installed entries have no manifest yet
  }
}
