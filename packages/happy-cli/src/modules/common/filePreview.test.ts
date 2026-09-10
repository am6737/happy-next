import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    mkdtemp,
    writeFile,
    rm,
    symlink,
    mkdir,
    rename,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    FILE_PREVIEW_CHUNK_SIZE,
    FILE_PREVIEW_TEXT_LIMIT,
    type OpenFilePreviewRequest,
} from 'happy-wire';
import { createFilePreviewHandlers, parsePreviewChanges } from './filePreview';

const exec = promisify(execFile);
let root: string;
let handlers: ReturnType<typeof createFilePreviewHandlers>;
const git = (...args: string[]) => exec('git', args, { cwd: root });
async function commit() {
    await git('add', '.');
    await git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '-m',
        'fixture'
    );
    return (await git('rev-parse', 'HEAD')).stdout.trim();
}
const request = (
    overrides: Partial<OpenFilePreviewRequest> = {}
): OpenFilePreviewRequest => ({
    path: 'file.md',
    repoPath: root,
    version: 'worktree',
    compare: true,
    ...overrides,
});
async function read(overrides: Partial<OpenFilePreviewRequest> = {}) {
    const result = await handlers.open(request(overrides));
    if (!result.success) throw new Error(JSON.stringify(result));
    const buffers: Buffer[] = [];
    let offset = 0;
    do {
        const chunk = await handlers.chunk({ token: result.token, offset });
        if (!chunk.success) throw new Error(chunk.error);
        buffers.push(Buffer.from(chunk.content, 'base64'));
        offset = chunk.nextOffset;
        if (chunk.done) break;
    } while (offset < result.size);
    await handlers.close({ token: result.token, offset: 0 });
    return { ...result, content: Buffer.concat(buffers).toString('utf8') };
}
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-preview-'));
    await git('init');
    handlers = createFilePreviewHandlers(root);
});
afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
});

describe('versioned file preview', () => {
    it('reads distinct working tree, index and commit versions', async () => {
        await writeFile(join(root, 'file.md'), '# committed\n');
        const revision = await commit();
        await writeFile(join(root, 'file.md'), '# staged\n');
        await git('add', 'file.md');
        await writeFile(join(root, 'file.md'), '# working\n');
        expect((await read()).content).toBe('# working\n');
        const staged = await read({ version: 'index' });
        expect(staged.content).toBe('# staged\n');
        expect(staged.diff).toContain('+# staged');
        const historical = await read({ version: 'commit', revision });
        expect(historical.content).toBe('# committed\n');
        expect(historical.diff).toContain('+# committed');
    });
    it('reads deleted working tree content from index with an explicit marker', async () => {
        await writeFile(join(root, 'file.md'), 'before');
        await commit();
        await rm(join(root, 'file.md'));
        expect(await read()).toMatchObject({
            deleted: true,
            version: 'index',
            content: 'before',
        });
    });
    it('reads staged and committed deletions from the correct previous version', async () => {
        await writeFile(join(root, 'file.md'), 'before');
        const parent = await commit();
        await git('rm', 'file.md');
        expect(await read({ version: 'index' })).toMatchObject({
            deleted: true,
            version: 'commit',
            revision: parent,
            content: 'before',
        });
        const deletion = await commit();
        expect(
            await read({ version: 'commit', revision: deletion })
        ).toMatchObject({ deleted: true, revision: parent, content: 'before' });
    });
    it('resolves renamed files from both old and new paths', async () => {
        await writeFile(join(root, 'file.md'), '# rename\n');
        await commit();
        await rename(join(root, 'file.md'), join(root, 'renamed.md'));
        const revision = await commit();
        for (const path of ['file.md', 'renamed.md'])
            expect(
                await read({ path, version: 'commit', revision })
            ).toMatchObject({ path: 'renamed.md', content: '# rename\n' });
    });
    it('supports spaces, unicode, newlines and literal git pathspec characters', async () => {
        const path = '中文 [a]*\n.md';
        await writeFile(join(root, path), 'unicode');
        const revision = await commit();
        expect(
            (await read({ path, version: 'commit', revision })).content
        ).toBe('unicode');
    });
    it('supports a session rooted in a repository subdirectory', async () => {
        await mkdir(join(root, 'sub'));
        await writeFile(join(root, 'sub/file.md'), 'first');
        await commit();
        await writeFile(join(root, 'sub/file.md'), 'second');
        await git('add', '.');
        handlers = createFilePreviewHandlers(join(root, 'sub'));
        expect(
            await read({ repoPath: join(root, 'sub'), version: 'index' })
        ).toMatchObject({ content: 'second', changed: true });
    });
    it('does not silently replace a missing commit file with working tree content', async () => {
        await writeFile(join(root, 'other.md'), 'other');
        const revision = await commit();
        await writeFile(join(root, 'file.md'), 'current');
        expect(
            await handlers.open(request({ version: 'commit', revision }))
        ).toMatchObject({ success: false, code: 'unavailable' });
    });
    it('reads empty files and non-git workspaces without requiring a diff', async () => {
        await rm(join(root, '.git'), { recursive: true });
        await writeFile(join(root, 'file.md'), '');
        expect(await read({ compare: false })).toMatchObject({
            size: 0,
            content: '',
            diffUnavailable: false,
        });
    });
    it('parses NUL-separated rename paths without interpreting whitespace', () => {
        expect(
            parsePreviewChanges('R100\0old name\0new\nname\0D\0gone\0')
        ).toEqual([
            { status: 'R100', oldPath: 'old name', path: 'new\nname' },
            { status: 'D', oldPath: 'gone', path: 'gone' },
        ]);
    });
});

describe('bounded preview snapshots', () => {
    it('preserves binary bytes and immutable chunk snapshots', async () => {
        const data = Buffer.alloc(FILE_PREVIEW_CHUNK_SIZE + 7, 0xff);
        data[0] = 0;
        await writeFile(join(root, 'file.pdf'), data);
        const opened = await handlers.open(
            request({ path: 'file.pdf', compare: false })
        );
        if (!opened.success) throw new Error(opened.error);
        await writeFile(join(root, 'file.pdf'), 'changed');
        const a = await handlers.chunk({ token: opened.token, offset: 0 });
        const b = await handlers.chunk({
            token: opened.token,
            offset: FILE_PREVIEW_CHUNK_SIZE,
        });
        if (!a.success || !b.success) throw new Error('failed');
        expect(a.done).toBe(false);
        expect(b.done).toBe(true);
        expect(Buffer.from(a.content + b.content, 'base64')).toEqual(data);
        await handlers.close({ token: opened.token, offset: 0 });
        expect(
            await handlers.chunk({ token: opened.token, offset: 0 })
        ).toMatchObject({ success: false, code: 'expired' });
    });
    it('rejects large text before transfer for worktree and git blobs', async () => {
        await writeFile(
            join(root, 'file.md'),
            Buffer.alloc(FILE_PREVIEW_TEXT_LIMIT + 1)
        );
        const revision = await commit();
        for (const version of ['worktree', 'index', 'commit'] as const)
            expect(
                await handlers.open(request({ version, revision }))
            ).toMatchObject({ success: false, code: 'too_large' });
    });
    it('rejects traversal, external symlinks, .git files and git symlink blobs', async () => {
        expect(
            await handlers.open(request({ path: '../outside.md' }))
        ).toMatchObject({ success: false, code: 'denied' });
        await symlink('/etc/passwd', join(root, 'file.md'));
        expect(await handlers.open(request())).toMatchObject({
            success: false,
            code: 'denied',
        });
        const revision = await commit();
        expect(
            await handlers.open(request({ version: 'commit', revision }))
        ).toMatchObject({ success: false, code: 'denied' });
        expect(
            await handlers.open(request({ path: '.git/secret.md' }))
        ).toMatchObject({ success: false, code: 'denied' });
    });
    it('rejects directory symlink escapes and invalid requests', async () => {
        await symlink(tmpdir(), join(root, 'outside'));
        expect(
            await handlers.open(request({ repoPath: join(root, 'outside') }))
        ).toMatchObject({ success: false, code: 'denied' });
        expect(await handlers.open({})).toMatchObject({
            success: false,
            code: 'denied',
        });
        expect(
            await handlers.chunk({ token: 'invalid', offset: -1 })
        ).toMatchObject({ success: false, code: 'denied' });
    });
    it('expires snapshots and isolates session tokens', async () => {
        await writeFile(join(root, 'file.md'), 'data');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const result = await handlers.open(request({ compare: false }));
        if (!result.success) throw new Error('failed');
        expect(
            await createFilePreviewHandlers(root).chunk({
                token: result.token,
                offset: 0,
            })
        ).toMatchObject({ success: false, code: 'expired' });
        await vi.advanceTimersByTimeAsync(120_001);
        expect(
            await handlers.chunk({ token: result.token, offset: 0 })
        ).toMatchObject({ success: false, code: 'expired' });
    });
});
