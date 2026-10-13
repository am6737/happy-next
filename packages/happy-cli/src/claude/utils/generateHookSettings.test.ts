import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEAMMATE_ENV } from 'happy-wire';
import { cleanupHookSettingsFile, generateHookSettingsFile } from './generateHookSettings';

const testConfig = vi.hoisted(() => ({ happyHomeDir: '' }));
vi.mock('@/configuration', () => ({ configuration: testConfig }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

describe('generateHookSettingsFile', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'happy-hook-settings-'));
        testConfig.happyHomeDir = dir;
    });
    afterEach(() => {
        cleanupHookSettingsFile(join(dir, 'tmp', 'hooks', `session-hook-${process.pid}.json`));
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    });

    it('enables native auto-compaction for Agent sessions only', () => {
        vi.stubEnv(TEAMMATE_ENV.teammateId, 'atlas');
        expect(JSON.parse(readFileSync(generateHookSettingsFile(1234), 'utf8'))).toMatchObject({ autoCompactEnabled: true });
        vi.stubEnv(TEAMMATE_ENV.teammateId, '');
        expect(JSON.parse(readFileSync(generateHookSettingsFile(1234), 'utf8'))).not.toHaveProperty('autoCompactEnabled');
    });
});
