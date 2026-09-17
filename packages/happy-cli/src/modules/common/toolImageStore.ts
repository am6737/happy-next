import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { getToolImagePath } from 'happy-wire';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

const recordSchema = z.object({
    path: z.string(),
    realPath: z.string(),
    dev: z.number(),
    ino: z.number(),
});

function recordPath(sessionId: string, callId: string) {
    const key = createHash('sha256').update(JSON.stringify([sessionId, callId])).digest('hex');
    return join(configuration.happyHomeDir, 'tool-images', `${key}.json`);
}

// Only the locally observed tool call can grant access. RPC callers never supply a file path.
export function registerToolImage(sessionId: string, workingDirectory: string, callId: string, input: unknown): void {
    const parsed = z.object({ path: z.string().min(1).max(4096) }).safeParse(input);
    if (!parsed.success || !callId || callId.length > 512) return;
    try {
        const path = resolve(workingDirectory, parsed.data.path);
        const realPath = realpathSync(path);
        const info = statSync(realPath);
        if (!info.isFile()) return;
        mkdirSync(join(configuration.happyHomeDir, 'tool-images'), { recursive: true, mode: 0o700 });
        // A replay of the same call must not reauthorize a replacement file.
        writeFileSync(recordPath(sessionId, callId), JSON.stringify({
            path, realPath, dev: info.dev, ino: info.ino,
        }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            logger.debug('[ToolImageStore] Cannot register image preview', error);
        }
    }
}

/**
 * Register the image a tool call reads, when that call names one. Called only with locally
 * observed tool calls, so the app can preview the file without ever supplying a path itself.
 */
export function registerToolImageForCall(sessionId: string, workingDirectory: string | undefined, toolName: string, callId: string, input: unknown): void {
    const path = getToolImagePath(toolName, input);
    if (path && workingDirectory) registerToolImage(sessionId, workingDirectory, callId, { path });
}

export function getToolImageRecord(sessionId: string, callId: string) {
    try {
        return recordSchema.parse(JSON.parse(readFileSync(recordPath(sessionId, callId), 'utf8')));
    } catch {
        return null;
    }
}
