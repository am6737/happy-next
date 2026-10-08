import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const testRoot = mkdtempSync(join(tmpdir(), 'gemini-isolation-test-'));
import { prepareIsolatedGeminiHome } from './geminiTaskIsolation';

describe('Gemini task isolation', () => {
  it('copies only OAuth auth and approved auth type, then removes the copy', () => {
    const root = mkdtempSync(join(testRoot, 'case-'));
    const repo = join(root, 'repo');
    const auth = join(root, 'auth', '.gemini');
    mkdirSync(repo); mkdirSync(auth, { recursive: true });
    writeFileSync(join(auth, 'oauth_creds.json'), '{"probe":"private"}');
    writeFileSync(join(auth, 'settings.json'), JSON.stringify({ mcpServers: { forbidden: {} },
      security: { auth: { selectedType: 'oauth-personal' } } }));
    try {
      const isolated = prepareIsolatedGeminiHome('task-1', repo, undefined, join(root, 'auth'), testRoot);
      const settings = JSON.parse(readFileSync(join(isolated.path, '.gemini', 'settings.json'), 'utf8'));
      expect(settings.mcpServers).toEqual({});
      expect(readFileSync(join(isolated.path, '.gemini', 'oauth_creds.json'), 'utf8')).toContain('private');
      isolated.cleanup();
      expect(existsSync(join(isolated.path, '.gemini', 'oauth_creds.json'))).toBe(false);
      const reentered = prepareIsolatedGeminiHome('task-1', repo, undefined, join(root, 'auth'), testRoot);
      reentered.cleanup();
      expect(() => prepareIsolatedGeminiHome('task-1', repo, 'session-1234', join(root, 'auth'), testRoot))
        .toThrow('exact Gemini private session verification unavailable');
      mkdirSync(join(repo, '.gemini'));
      expect(() => prepareIsolatedGeminiHome('task-2', repo, undefined, join(root, 'auth'), testRoot))
        .toThrow('project configuration cannot be isolated');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects an absent OAuth source without starting a provider', () => {
    const root = mkdtempSync(join(testRoot, 'missing-'));
    const repo = join(root, 'repo');
    const auth = join(root, 'auth', '.gemini');
    mkdirSync(repo); mkdirSync(auth, { recursive: true });
    writeFileSync(join(auth, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
    try {
      expect(() => prepareIsolatedGeminiHome('missing-task', repo, undefined, join(root, 'auth'), testRoot))
        .toThrow('GEMINI_AUTH_UNAVAILABLE');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
