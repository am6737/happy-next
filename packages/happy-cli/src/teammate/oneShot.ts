import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { query } from '@/claude/sdk/query';
import type { SDKMessage } from '@/claude/sdk/types';
import { logger } from '@/ui/logger';
import { codexPackage } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';
import { DISALLOWED_TOOLS } from './draft';

export interface OneShotOptions {
    provider: 'claude' | 'codex';
    systemPrompt: string;
    prompt: string;
    model?: string | null;
    env?: Record<string, string>;
    codexHome?: string;
    timeoutMs: number;
}

export interface OneShotDeps {
    claudeQuery?: typeof query;
    spawn?: typeof spawn;
}

function assistantText(message: SDKMessage): string {
    if (message.type !== 'assistant') return '';
    const content = (message as { message?: { content?: unknown } }).message?.content;
    return (Array.isArray(content) ? content : []).filter((block): block is { type: 'text'; text: string } =>
        !!block && typeof block === 'object' && (block as { type?: string }).type === 'text' && typeof (block as { text?: unknown }).text === 'string')
        .map(block => block.text).join('');
}

async function claudeOneShot(options: OneShotOptions, deps: OneShotDeps): Promise<string> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('One-shot Claude call timed out')); }, options.timeoutMs);
    });
    try {
        // Channel content stays off argv: it is private and can exceed the per-argument size limit.
        const prompt = (async function* () {
            yield { type: 'user' as const, message: { role: 'user' as const, content: options.prompt } };
        })();
        const run = (deps.claudeQuery ?? query)({ prompt, options: {
            customSystemPrompt: options.systemPrompt,
            maxTurns: 1,
            cwd: os.tmpdir(),
            abort: controller.signal,
            disallowedTools: DISALLOWED_TOOLS,
            strictMcpConfig: true,
            model: options.model ?? undefined,
            env: options.env,
        } });
        const collect = async () => {
            let result = '';
            for await (const message of run) {
                result += assistantText(message);
                if (message.type === 'result' && typeof (message as { result?: unknown }).result === 'string') result = (message as unknown as { result: string }).result;
            }
            if (!result) throw new Error('One-shot model returned no text');
            return result;
        };
        return await Promise.race([collect(), timeoutPromise]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function waitForCodex(child: ChildProcessWithoutNullStreams, output: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('One-shot Codex call timed out')); }, timeoutMs);
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(stderr || `Codex exited with code ${code}`));
        });
        child.stdout.on('data', chunk => { output += String(chunk); });
    });
}

async function codexOneShot(options: OneShotOptions, deps: OneShotDeps): Promise<string> {
    const temp = await mkdtemp(join(os.tmpdir(), 'happy-teammate-summary-'));
    const outputPath = join(temp, 'output.md');
    const runtime = resolveCodexRuntime(codexPackage(), ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-o', outputPath, ...(options.model ? ['-m', options.model] : []), '-']);
    const child = (deps.spawn ?? spawn)(runtime.command, runtime.args, { cwd: temp, env: { ...process.env, ...options.env, ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    try {
        child.stdin.end(`${options.systemPrompt}\n\n${options.prompt}`);
        await waitForCodex(child, '', options.timeoutMs);
        return await readFile(outputPath, 'utf8');
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}

export async function runTeammateOneShot(options: OneShotOptions, deps: OneShotDeps = {}): Promise<string> {
    try {
        return options.provider === 'claude' ? await claudeOneShot(options, deps) : await codexOneShot(options, deps);
    } catch (error) {
        logger.debug(`[TEAMMATE] One-shot summary failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
