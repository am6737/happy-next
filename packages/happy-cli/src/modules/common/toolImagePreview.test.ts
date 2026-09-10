import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_PREVIEW_BINARY_LIMIT, FILE_PREVIEW_CHUNK_SIZE } from 'happy-wire';
import { createToolImagePreviewHandlers } from './toolImagePreview';
import { getToolImageRecord, registerToolImage } from './toolImageStore';
import { registerCommonHandlers } from './registerCommonHandlers';

const config = vi.hoisted(() => ({ home: '' }));
vi.mock('@/configuration', () => ({ configuration: { get happyHomeDir() { return config.home; } } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1x8AAAAASUVORK5CYII=', 'base64');
let root: string;
let workspace: string;
let path: string;
let handlers: ReturnType<typeof createToolImagePreviewHandlers>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-tool-image-'));
    config.home = join(root, 'home');
    workspace = join(root, 'workspace');
    await mkdir(workspace);
    path = join(root, 'outside-workspace.png');
    await writeFile(path, png);
    handlers = createToolImagePreviewHandlers('session-a');
});

afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
});

function register(callId = 'call-a', imagePath = path) {
    registerToolImage('session-a', workspace, callId, { path: imagePath });
}

describe('tool image preview', () => {
    it('reads the registered image outside the workspace and survives handler recreation', async () => {
        register();
        handlers = createToolImagePreviewHandlers('session-a');
        const opened = await handlers.open({ callId: 'call-a' });
        expect(opened).toMatchObject({ success: true, path, mimeType: 'image/png', size: png.length });
        if (!opened.success) throw new Error('open failed');
        expect(await handlers.chunk({ token: opened.token, offset: 0 })).toEqual({
            success: true, content: png.toString('base64'), nextOffset: png.length, done: true,
        });
        await handlers.close({ token: opened.token, offset: 0 });
        expect(await handlers.chunk({ token: opened.token, offset: 0 })).toMatchObject({ code: 'expired' });
    });

    it('resolves relative paths against the session working directory', async () => {
        await writeFile(join(workspace, 'local.png'), png);
        register('local', 'local.png');
        expect(getToolImageRecord('session-a', 'local')?.path).toBe(join(workspace, 'local.png'));
    });

    it('rejects arbitrary paths, other sessions, missing calls and invalid requests', async () => {
        register();
        for (const request of [null, {}, { callId: '' }, { callId: 'x'.repeat(513) }, { callId: 'call-a', path }, { callId: '../other-session' }]) {
            expect(await handlers.open(request)).toMatchObject({ success: false, code: 'denied' });
        }
        expect(await createToolImagePreviewHandlers('session-b').open({ callId: 'call-a' })).toMatchObject({ error: 'image_not_registered' });
        expect(await createToolImagePreviewHandlers().open({ callId: 'call-a' })).toMatchObject({ code: 'denied' });
    });

    it('does not register directories or malformed inputs', () => {
        register('directory', workspace);
        registerToolImage('session-a', workspace, 'invalid', { path: 1 });
        expect(getToolImageRecord('session-a', 'directory')).toBeNull();
        expect(getToolImageRecord('session-a', 'invalid')).toBeNull();
    });

    it('denies a replaced file even if the original call is replayed', async () => {
        register();
        await rename(path, `${path}.old`);
        await writeFile(path, png);
        register();
        expect(await handlers.open({ callId: 'call-a' })).toMatchObject({ success: false, error: 'image_changed' });
    });

    it('allows an original symlink but rejects retargeting it', async () => {
        const link = join(root, 'linked.png');
        await symlink(path, link);
        register('linked', link);
        const opened = await handlers.open({ callId: 'linked' });
        expect(opened.success).toBe(true);
        if (opened.success) await handlers.close({ token: opened.token, offset: 0 });
        const other = join(root, 'other.png');
        await writeFile(other, png);
        await rm(link);
        await symlink(other, link);
        expect(await handlers.open({ callId: 'linked' })).toMatchObject({ error: 'image_changed' });
    });

    it('distinguishes missing, oversized and unsupported files', async () => {
        register();
        await rm(path);
        expect(await handlers.open({ callId: 'call-a' })).toMatchObject({ error: 'image_missing' });
        const large = join(root, 'large.png');
        await writeFile(large, png);
        await truncate(large, FILE_PREVIEW_BINARY_LIMIT + 1);
        register('large', large);
        expect(await handlers.open({ callId: 'large' })).toMatchObject({ code: 'too_large' });
        const fake = join(root, 'fake.png');
        await writeFile(fake, 'not an image');
        register('fake', fake);
        expect(await handlers.open({ callId: 'fake' })).toMatchObject({ error: 'image_unsupported' });
    });

    it.each([
        ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
        ['gif', Buffer.from('GIF89a'), 'image/gif'],
        ['webp', Buffer.from('RIFFxxxxWEBP'), 'image/webp'],
    ])('detects %s without depending on the extension', async (_, data, mimeType) => {
        const image = join(root, 'image-without-extension');
        await writeFile(image, data);
        register('format', image);
        const opened = await handlers.open({ callId: 'format' });
        expect(opened).toMatchObject({ success: true, mimeType });
        if (opened.success) await handlers.close({ token: opened.token, offset: 0 });
    });

    it('transfers bounded immutable chunks and scopes tokens to the handler', async () => {
        const data = Buffer.concat([png, Buffer.alloc(FILE_PREVIEW_CHUNK_SIZE, 42)]);
        await writeFile(path, data);
        register();
        const opened = await handlers.open({ callId: 'call-a' });
        if (!opened.success) throw new Error('open failed');
        await writeFile(path, png);
        const first = await handlers.chunk({ token: opened.token, offset: 0 });
        expect(first).toMatchObject({ nextOffset: FILE_PREVIEW_CHUNK_SIZE, done: false });
        if (!first.success) throw new Error('chunk failed');
        expect(Buffer.from(first.content, 'base64')).toEqual(data.subarray(0, FILE_PREVIEW_CHUNK_SIZE));
        const last = await handlers.chunk({ token: opened.token, offset: FILE_PREVIEW_CHUNK_SIZE });
        expect(last).toMatchObject({ nextOffset: data.length, done: true });
        expect(await handlers.chunk({ token: opened.token, offset: -1 })).toMatchObject({ code: 'denied' });
        expect(await handlers.chunk({ token: opened.token, offset: data.length + 1 })).toMatchObject({ code: 'denied' });
        expect(await createToolImagePreviewHandlers('session-b').chunk({ token: opened.token, offset: 0 })).toMatchObject({ code: 'expired' });
        await handlers.close({ token: opened.token, offset: 0 });
    });

    it('expires abandoned snapshots', async () => {
        vi.useFakeTimers();
        register();
        const opened = await handlers.open({ callId: 'call-a' });
        if (!opened.success) throw new Error('open failed');
        await vi.advanceTimersByTimeAsync(120_001);
        expect(await handlers.chunk({ token: opened.token, offset: 0 })).toMatchObject({ code: 'expired' });
    });

    it('registers all three RPC handlers in the current session', async () => {
        const methods = new Map<string, (input: unknown) => Promise<unknown>>();
        registerCommonHandlers({ registerHandler: (name: string, handler: (input: unknown) => Promise<unknown>) => methods.set(name, handler) } as any, workspace, 'session-a');
        register();
        const opened = await methods.get('openToolImagePreview')!({ callId: 'call-a' }) as { token: string; success: boolean };
        expect(opened.success).toBe(true);
        expect(await methods.get('readToolImagePreviewChunk')!({ token: opened.token, offset: 0 })).toMatchObject({ success: true });
        expect(await methods.get('closeToolImagePreview')!({ token: opened.token, offset: 0 })).toEqual({ success: true });
    });
});
