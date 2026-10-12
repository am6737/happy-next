import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DISALLOWED_TOOLS } from './draft';
import { runTeammateOneShot } from './oneShot';

describe('runTeammateOneShot', () => {
    it('passes Claude prompts as an async user message and returns result text', async () => {
        let received: any;
        const claudeQuery = vi.fn((config: any) => {
            received = config;
            return (async function* () {
                yield { type: 'result', result: 'summary text' } as any;
            })();
        }) as any;
        const result = await runTeammateOneShot({ provider: 'claude', systemPrompt: 'rules', prompt: 'private content', env: { TEST_ENV: 'yes' }, timeoutMs: 1000 }, { claudeQuery });
        expect(result).toBe('summary text');
        expect(typeof received.prompt).toBe('object');
        const messages = [];
        for await (const message of received.prompt) messages.push(message);
        expect(messages).toEqual([{ type: 'user', message: { role: 'user', content: 'private content' } }]);
        expect(received.options).toMatchObject({ customSystemPrompt: 'rules', disallowedTools: DISALLOWED_TOOLS, strictMcpConfig: true, maxTurns: 1, env: { TEST_ENV: 'yes' } });
    });

    it('runs Codex with an ephemeral output file and cleans its temp directory', async () => {
        const codexHome = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
        let captured: { command: string; args: string[]; options: any } | undefined;
        let input = '';
        const child = new EventEmitter() as any;
        child.stdin = new Writable({ write(chunk, _encoding, callback) { input += String(chunk); callback(); } });
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        const spawn = vi.fn((command: string, args: string[], options: any) => {
            captured = { command, args, options };
            const outputPath = args[args.indexOf('-o') + 1];
            void writeFile(outputPath, 'codex summary').then(() => child.emit('close', 0));
            return child;
        }) as any;
        try {
            await expect(runTeammateOneShot({ provider: 'codex', systemPrompt: 'rules', prompt: 'prompt', codexHome, timeoutMs: 1000 }, { spawn })).resolves.toBe('codex summary');
            expect(captured?.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-', '-o']));
            expect(captured?.args[captured?.args.indexOf('-o') + 1]).toMatch(/output\.md$/);
            expect(captured?.options.env).toMatchObject({ CODEX_HOME: codexHome });
            expect(input).toBe('rules\n\nprompt');
            await expect(stat(captured!.options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('kills Codex and rejects when the timeout expires', async () => {
        const spawn = vi.fn(() => {
            const child = new EventEmitter() as any;
            child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.kill = vi.fn();
            return child;
        }) as any;
        await expect(runTeammateOneShot({ provider: 'codex', systemPrompt: 'rules', prompt: 'prompt', timeoutMs: 10 }, { spawn })).rejects.toThrow('timed out');
        expect(spawn.mock.results[0].value.kill).toHaveBeenCalledWith('SIGTERM');
    });
});
