import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_INITIALIZE_TIMEOUT_MS, codexPackageVersion, isCodexRuntimeWarm, pickCodexRuntime } from './codexRuntime';

describe('CODEX_INITIALIZE_TIMEOUT_MS', () => {
  it('gives the cold-start handshake more time than a regular request gets', () => {
    expect(CODEX_INITIALIZE_TIMEOUT_MS).toBeGreaterThan(60_000);
  });
});

describe('codexPackageVersion', () => {
  it('reads an exact pinned version', () => {
    expect(codexPackageVersion('@openai/codex@0.155.1')).toBe('0.155.1');
    expect(codexPackageVersion('@openai/codex@0.155.1-beta.2')).toBe('0.155.1-beta.2');
    expect(codexPackageVersion('codex@1.2.3')).toBe('1.2.3');
  });

  it('refuses anything that is not an exact version', () => {
    expect(codexPackageVersion('@openai/codex')).toBeNull();
    expect(codexPackageVersion('@openai/codex@latest')).toBeNull();
    expect(codexPackageVersion('@openai/codex@^0.155.0')).toBeNull();
    expect(codexPackageVersion('@openai/codex@0.155')).toBeNull();
  });
});

describe('pickCodexRuntime', () => {
  it('uses the local binary when it is the pinned version', () => {
    expect(pickCodexRuntime('@openai/codex@0.155.1', ['app-server'], '0.155.1'))
      .toEqual({ command: 'codex', args: ['app-server'] });
  });

  it('falls back to npx when the local binary is a different version', () => {
    expect(pickCodexRuntime('@openai/codex@0.155.1', ['app-server'], '0.153.4'))
      .toEqual({ command: 'npx', args: ['-y', '@openai/codex@0.155.1', 'app-server'] });
  });

  it('falls back to npx without a local binary and for unpinned specs', () => {
    expect(pickCodexRuntime('@openai/codex@0.155.1', ['exec', 'hello'], null))
      .toEqual({ command: 'npx', args: ['-y', '@openai/codex@0.155.1', 'exec', 'hello'] });
    expect(pickCodexRuntime('@openai/codex', ['app-server'], '0.155.1'))
      .toEqual({ command: 'npx', args: ['-y', '@openai/codex', 'app-server'] });
  });
});

describe('isCodexRuntimeWarm', () => {
  // A version no local `codex` can be, so the npx cache decides on every machine.
  const UNMATCHABLE_SPEC = '@openai/codex@9.9.9';
  let cacheRoot: string | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true });
    cacheRoot = null;
  });

  async function npxCacheWith(version: string): Promise<string> {
    cacheRoot = await mkdtemp(join(tmpdir(), 'happy-codex-npx-'));
    const manifestDir = join(cacheRoot, '_npx', 'deadbeef', 'node_modules', '@openai', 'codex');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'package.json'), JSON.stringify({ name: '@openai/codex', version }));
    vi.stubEnv('npm_config_cache', cacheRoot);
    return cacheRoot;
  }

  it('is warm when the npx cache already holds the pinned version', async () => {
    await npxCacheWith('9.9.9');
    expect(isCodexRuntimeWarm(UNMATCHABLE_SPEC)).toBe(true);
  });

  it('is cold when the cache holds another version or no manifest at all', async () => {
    await npxCacheWith('0.153.4');
    expect(isCodexRuntimeWarm(UNMATCHABLE_SPEC)).toBe(false);
    expect(isCodexRuntimeWarm('@openai/codex@latest')).toBe(false);
  });

  it('is cold when there is no npx cache', () => {
    vi.stubEnv('npm_config_cache', join(tmpdir(), 'happy-codex-missing-cache'));
    expect(isCodexRuntimeWarm(UNMATCHABLE_SPEC)).toBe(false);
  });
});
