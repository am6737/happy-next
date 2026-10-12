import { open } from 'node:fs/promises';

/**
 * The whole lines among the last `maxBytes` of a file, newest first, so the latest
 * records of an append-only log are found without reading all of it.
 */
export async function readTailLines(path: string, maxBytes = 1024 * 1024): Promise<string[]> {
    const file = await open(path, 'r');
    try {
        const { size } = await file.stat();
        const start = Math.max(0, size - maxBytes);
        const buffer = Buffer.alloc(size - start);
        await file.read(buffer, 0, buffer.length, start);
        const lines = buffer.toString('utf8').split('\n');
        // A read that starts mid-file cuts its first line short.
        if (start > 0) lines.shift();
        return lines.reverse();
    } finally {
        await file.close();
    }
}
