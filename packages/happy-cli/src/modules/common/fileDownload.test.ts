import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, symlink, mkdir, rename, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FILE_DOWNLOAD_LIMIT, FILE_PREVIEW_CHUNK_SIZE, type OpenFileDownloadRequest } from 'happy-wire';
import { createFileDownloadHandlers, createFilePreviewHandlers } from './filePreview';

const exec = promisify(execFile);
let root: string;
let handlers: ReturnType<typeof createFileDownloadHandlers>;
const git = (...args: string[]) => exec('git', args, { cwd: root });
const request = (overrides: Partial<OpenFileDownloadRequest> = {}): OpenFileDownloadRequest => ({
    path: 'file.bin', repoPath: root, version: 'worktree', compare: false, ...overrides,
});
async function commit() {
    await git('add', '.');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture');
    return (await git('rev-parse', 'HEAD')).stdout.trim();
}
async function read(overrides: Partial<OpenFileDownloadRequest> = {}) {
    const metadata = await handlers.open(request(overrides));
    if (!metadata.success) throw new Error(metadata.error);
    const chunks: Buffer[] = [];
    let offset = 0;
    try {
        while (offset < metadata.size) {
            const chunk = await handlers.chunk({ token: metadata.token, offset });
            if (!chunk.success) throw new Error(chunk.error);
            expect(Buffer.from(chunk.content, 'base64').length).toBeLessThanOrEqual(FILE_PREVIEW_CHUNK_SIZE);
            chunks.push(Buffer.from(chunk.content, 'base64'));
            offset = chunk.nextOffset;
            expect(chunk.done).toBe(offset === metadata.size);
        }
        return { ...metadata, data: Buffer.concat(chunks) };
    } finally {
        await handlers.close({ token: metadata.token, offset: 0 });
    }
}
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-download-'));
    await git('init');
    handlers = createFileDownloadHandlers(root);
});
afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
});

describe('arbitrary file downloads', () => {
    it.each(['file.bin', 'file.ts', 'file.zip', 'file.woff2', 'LICENSE', '.env', '中文 [x]*\n.bin'])('preserves original bytes for %s', async (path) => {
        const data = Buffer.alloc(FILE_PREVIEW_CHUNK_SIZE + 13, 0xff);
        data[0] = 0;
        await writeFile(join(root, path), data);
        expect((await read({ path })).data).toEqual(data);
    });
    it('downloads empty files outside Git', async () => {
        await rm(join(root, '.git'), { recursive: true });
        await writeFile(join(root, 'file.bin'), '');
        expect(await read()).toMatchObject({ size: 0, data: Buffer.alloc(0) });
    });
    it('separates worktree, index and commit bytes', async () => {
        await writeFile(join(root, 'file.bin'), Buffer.from([0, 1, 255]));
        const revision = await commit();
        await writeFile(join(root, 'file.bin'), Buffer.from([0, 2, 254]));
        await git('add', '.');
        await writeFile(join(root, 'file.bin'), Buffer.from([0, 3, 253]));
        expect((await read()).data).toEqual(Buffer.from([0, 3, 253]));
        expect((await read({ version: 'index' })).data).toEqual(Buffer.from([0, 2, 254]));
        expect((await read({ version: 'commit', revision })).data).toEqual(Buffer.from([0, 1, 255]));
    });
    it('resolves deletions and renames without substituting another version', async () => {
        await writeFile(join(root, 'file.bin'), 'before');
        const parent = await commit();
        await rm(join(root, 'file.bin'));
        expect(await read({ compare: true })).toMatchObject({ version: 'index', deleted: true, data: Buffer.from('before') });
        await git('add', '.');
        expect(await read({ version: 'index' })).toMatchObject({ version: 'commit', revision: parent, deleted: true });
        const deletion = await commit();
        expect(await read({ version: 'commit', revision: deletion })).toMatchObject({ revision: parent, deleted: true });
        await writeFile(join(root, 'file.bin'), 'renamed data');
        await commit();
        await rename(join(root, 'file.bin'), join(root, 'renamed.zip'));
        const revision = await commit();
        expect(await read({ version: 'commit', revision })).toMatchObject({ path: 'renamed.zip', data: Buffer.from('renamed data') });
    });
    it('fails closed for missing history and invalid comparisons', async () => {
        await writeFile(join(root, 'other'), 'old');
        const revision = await commit();
        await writeFile(join(root, 'file.bin'), 'current');
        expect(await handlers.open(request({ version: 'commit', revision }))).toMatchObject({ success: false, code: 'unavailable' });
        await rm(join(root, '.git'), { recursive: true });
        expect(await handlers.open(request({ compare: true }))).toMatchObject({ success: false, code: 'unavailable' });
    });
    it('allows 100 MiB but rejects one extra byte in worktree and Git', async () => {
        const file = await open(join(root, 'file.bin'), 'w');
        await file.truncate(FILE_DOWNLOAD_LIMIT);
        await file.close();
        const revision = await commit();
        for (const version of ['worktree', 'index', 'commit'] as const) {
            const opened = await handlers.open(request({ version, revision }));
            if (!opened.success) throw new Error(opened.error);
            expect(opened.size).toBe(FILE_DOWNLOAD_LIMIT);
            expect(await handlers.chunk({ token: opened.token, offset: FILE_DOWNLOAD_LIMIT - 1 })).toMatchObject({ success: true, content: 'AA==', done: true });
            await handlers.close({ token: opened.token, offset: 0 });
        }
        const larger = await open(join(root, 'file.bin'), 'r+');
        await larger.truncate(FILE_DOWNLOAD_LIMIT + 1);
        await larger.close();
        const largeRevision = await commit();
        for (const version of ['worktree', 'index', 'commit'] as const)
            expect(await handlers.open(request({ version, revision: largeRevision }))).toMatchObject({ success: false, code: 'too_large' });
    }, 30000);
    it('uses a separate limit from previews', async () => {
        await writeFile(join(root, 'large.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
        expect(await createFilePreviewHandlers(root).open(request({ path: 'large.md' }))).toMatchObject({ success: false, code: 'too_large' });
        expect((await read({ path: 'large.md' })).size).toBe(2 * 1024 * 1024 + 1);
    });
    it('rejects traversal, directories, external symlinks and Git internals', async () => {
        await mkdir(join(root, 'directory'));
        await symlink('/etc/passwd', join(root, 'file.bin'));
        for (const path of ['../outside', 'directory', 'file.bin', '.git/config'])
            expect(await handlers.open(request({ path }))).toMatchObject({ success: false, code: 'denied' });
        const revision = await commit();
        for (const version of ['index', 'commit'] as const)
            expect(await handlers.open(request({ version, revision }))).toMatchObject({ success: false, code: 'denied' });
        await git('update-index', '--add', '--cacheinfo', '160000', revision, 'module');
        expect(await handlers.open(request({ path: 'module', version: 'index' }))).toMatchObject({ success: false, code: 'denied' });
    });
    it('isolates tokens, limits concurrency, and releases on close or expiry', async () => {
        await writeFile(join(root, 'file.bin'), 'snapshot');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const [first, second] = await Promise.all([handlers.open(request()), handlers.open(request())]);
        if (!first.success) throw new Error(first.error);
        expect(second.success).toBe(false);
        expect((await handlers.open(request())).success).toBe(false);
        expect(await createFileDownloadHandlers(root).chunk({ token: first.token, offset: 0 })).toMatchObject({ code: 'expired' });
        expect(await createFilePreviewHandlers(root).chunk({ token: first.token, offset: 0 })).toMatchObject({ code: 'expired' });
        await writeFile(join(root, 'file.bin'), 'modified');
        expect(await handlers.chunk({ token: first.token, offset: 0 })).toMatchObject({ content: Buffer.from('snapshot').toString('base64') });
        await handlers.close({ token: first.token, offset: 0 });
        expect(await handlers.chunk({ token: first.token, offset: 0 })).toMatchObject({ code: 'expired' });
        const next = await handlers.open(request());
        if (!next.success) throw new Error(next.error);
        await vi.advanceTimersByTimeAsync(120001);
        expect(await handlers.chunk({ token: next.token, offset: 0 })).toMatchObject({ code: 'expired' });
        const final = await handlers.open(request());
        if (!final.success) throw new Error(final.error);
        await handlers.close({ token: final.token, offset: 0 });
    });
    it('rejects conflicted index entries and invalid chunk requests', async () => {
        await writeFile(join(root, 'file.bin'), 'base');
        await commit();
        const oid = (await git('rev-parse', ':file.bin')).stdout.trim();
        const update = exec('git', ['update-index', '--index-info'], { cwd: root });
        update.child.stdin!.end(`0 ${'0'.repeat(40)}\tfile.bin\n100644 ${oid} 1\tfile.bin\n100644 ${oid} 2\tfile.bin\n`);
        await update;
        expect(await handlers.open(request({ version: 'index' }))).toMatchObject({ success: false, code: 'denied' });
        expect(await handlers.chunk({ token: 'bad', offset: -1 })).toMatchObject({ success: false, code: 'denied' });
        const opened = await handlers.open(request());
        if (!opened.success) throw new Error(opened.error);
        expect(await handlers.chunk({ token: opened.token, offset: opened.size + 1 })).toMatchObject({ success: false, code: 'denied' });
        await handlers.close({ token: opened.token, offset: 0 });
    });
});
