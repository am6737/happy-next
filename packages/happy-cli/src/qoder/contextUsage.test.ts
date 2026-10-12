import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQoderContextUsage } from './contextUsage';

const assistant = (ratio: number, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    isSidechain: false,
    message: { model: 'efficient', usage: { input_tokens: 0, output_tokens: 0, context_usage_ratio: ratio } },
    ...extra,
});

describe('readQoderContextUsage', () => {
    let configDir: string;

    const writeTranscript = (records: unknown[]) => {
        const projectDir = join(configDir, 'projects', '-repo-work');
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(join(projectDir, 'qoder-session.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    };

    const writeRunLog = (run: string, lines: string[]) => {
        mkdirSync(join(configDir, 'logs', 'runs', run), { recursive: true });
        writeFileSync(join(configDir, 'logs', 'runs', run, 'qodercli.log'), lines.join('\n') + '\n');
    };

    const modelConfig = (model: string, window: number) =>
        `2026-10-11T15:39:47.195Z INFO  debug.message [QoderInferRequest details] model_config={"key":"${model}","display_name":"X","source":"system","max_input_tokens":${window}}, custom_model=null`;

    beforeEach(() => {
        configDir = mkdtempSync(join(tmpdir(), 'qoder-context-'));
        vi.stubEnv('QODER_CONFIG_DIR', configDir);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(configDir, { recursive: true, force: true });
    });

    it('scales the latest main-chain ratio by the window the process logged for its model', async () => {
        writeTranscript([
            assistant(0.1),
            assistant(0.25),
            assistant(0.9, { isSidechain: true }),
            { type: 'user', message: { content: 'next' } },
        ]);
        writeRunLog('2026-10-11T15-39-45-370Z-yj84r0-p4242', [modelConfig('efficient', 128000), modelConfig('ultimate', 1000000)]);

        expect(await readQoderContextUsage('qoder-session', 4242)).toEqual({ usedTokens: 32000, windowSize: 128000 });
    });

    it('reads the newest run of a reused pid', async () => {
        writeTranscript([assistant(0.5)]);
        writeRunLog('2026-10-01T10-00-00-000Z-aaaaaa-p4242', [modelConfig('efficient', 100000)]);
        writeRunLog('2026-10-11T10-00-00-000Z-bbbbbb-p4242', [modelConfig('efficient', 300000)]);

        expect(await readQoderContextUsage('qoder-session', 4242)).toEqual({ usedTokens: 150000, windowSize: 300000 });
    });

    it('falls back to the default Qoder window without a run log', async () => {
        writeTranscript([assistant(0.5)]);

        expect(await readQoderContextUsage('qoder-session', undefined)).toEqual({ usedTokens: 100000, windowSize: 200000 });
    });

    it('returns null for a conversation without a recorded ratio, or none at all', async () => {
        writeTranscript([{ type: 'user', message: { content: 'hi' } }]);

        expect(await readQoderContextUsage('qoder-session', 4242)).toBeNull();
        expect(await readQoderContextUsage('missing-session', 4242)).toBeNull();
    });
});
