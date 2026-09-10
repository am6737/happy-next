import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
    FILE_PREVIEW_BINARY_LIMIT,
    FILE_PREVIEW_TEXT_LIMIT,
    FILE_PREVIEW_CHUNK_SIZE,
    openFilePreviewRequestSchema,
    filePreviewChunkRequestSchema,
    getFilePreviewType,
    type OpenFilePreviewResponse,
    type FilePreviewChunkResponse,
    type FilePreviewFailure,
} from 'happy-wire';

const execFileAsync = promisify(execFile);
const TTL = 120_000;
const CACHE_LIMIT = 40 * 1024 * 1024;
const DIFF_LIMIT = 512 * 1024;

class PreviewError extends Error {
    constructor(
        public code: FilePreviewFailure['code'],
        message: string
    ) {
        super(message);
    }
}

function assertWithin(root: string, path: string) {
    const rel = relative(root, path);
    if (
        rel === '..' ||
        rel.startsWith(`..${sep}`) ||
        resolve(root, rel) !== path ||
        rel.split(sep).includes('.git')
    ) {
        throw new PreviewError(
            'denied',
            'File is outside the permitted workspace'
        );
    }
}

async function git(
    cwd: string,
    args: string[],
    maxBuffer = DIFF_LIMIT
): Promise<Buffer> {
    const result = await execFileAsync(
        'git',
        ['-c', 'core.fsmonitor=false', '--literal-pathspecs', ...args],
        {
            cwd,
            encoding: 'buffer',
            maxBuffer,
            timeout: 15_000,
            env: {
                ...process.env,
                GIT_OPTIONAL_LOCKS: '0',
                GIT_PAGER: 'cat',
                GIT_TERMINAL_PROMPT: '0',
                GIT_NO_LAZY_FETCH: '1',
            },
        }
    );
    return result.stdout;
}

function failure(error: unknown): FilePreviewFailure {
    return {
        success: false,
        code: error instanceof PreviewError ? error.code : 'unavailable',
        error:
            error instanceof PreviewError
                ? error.message
                : 'Cannot read this file version',
    };
}

type Change = { status: string; oldPath: string; path: string };
export function parsePreviewChanges(output: string): Change[] {
    const fields = output.split('\0');
    const changes: Change[] = [];
    for (let i = 0; fields[i];) {
        const status = fields[i++];
        const oldPath = fields[i++];
        const path = /^[RC]/.test(status) ? fields[i++] : oldPath;
        if (path !== undefined && oldPath !== undefined)
            changes.push({ status, path, oldPath });
    }
    return changes;
}

// Each handler instance belongs to one session. Snapshots are immutable and never shared across sessions.
export function createFilePreviewHandlers(workingDirectory: string) {
    const snapshots = new Map<
        string,
        { data: Buffer; timer: ReturnType<typeof setTimeout> }
    >();
    let cachedBytes = 0;
    function release(token: string) {
        const item = snapshots.get(token);
        if (item) {
            clearTimeout(item.timer);
            cachedBytes -= item.data.length;
            snapshots.delete(token);
        }
    }

    return {
        async open(input: unknown): Promise<OpenFilePreviewResponse> {
            try {
                const parsed = openFilePreviewRequestSchema.safeParse(input);
                if (!parsed.success)
                    throw new PreviewError('denied', 'Invalid preview request');
                const request = parsed.data;
                let type = getFilePreviewType(request.path);
                if (!type)
                    throw new PreviewError(
                        'unavailable',
                        'Unsupported preview type'
                    );
                const root = await realpath(workingDirectory);
                const lexicalRepo = resolve(workingDirectory, request.repoPath);
                assertWithin(resolve(workingDirectory), lexicalRepo);
                const repo = await realpath(lexicalRepo);
                assertWithin(root, repo);
                const absolutePath = resolve(lexicalRepo, request.path);
                assertWithin(lexicalRepo, absolutePath);
                const requestedPath = relative(lexicalRepo, absolutePath)
                    .split(sep)
                    .join('/');
                let path = requestedPath;
                let version = request.version;
                let revision: string | undefined;
                let deleted = false;
                let diff = '';
                let diffUnavailable = false;
                let change: Change | undefined;
                let comparison: string[] = [];
                let rootCommit = false;
                if (request.version === 'commit') {
                    if (!request.revision)
                        throw new PreviewError(
                            'denied',
                            'Missing commit revision'
                        );
                    revision = (
                        await git(repo, [
                            'rev-parse',
                            '--verify',
                            '--end-of-options',
                            `${request.revision}^{commit}`,
                        ])
                    )
                        .toString()
                        .trim();
                    let parent: string | undefined;
                    try {
                        parent = (
                            await git(repo, [
                                'rev-parse',
                                '--verify',
                                `${revision}^`,
                            ])
                        )
                            .toString()
                            .trim();
                    } catch {
                        /* Initial commit has no parent. */
                    }
                    rootCommit = !parent;
                    comparison = parent
                        ? ['diff', parent, revision]
                        : ['show', '--format=', '--root', revision];
                } else {
                    comparison =
                        request.version === 'index'
                            ? ['diff', '--cached']
                            : ['diff'];
                }
                if (request.compare || request.version !== 'worktree') {
                    try {
                        const names = await git(repo, [
                            ...comparison,
                            '--relative',
                            '--no-ext-diff',
                            '--no-textconv',
                            '--find-renames',
                            '--name-status',
                            '-z',
                            '--',
                            '.',
                        ]);
                        change = parsePreviewChanges(
                            names.toString('utf8')
                        ).find(
                            (item) =>
                                item.path === path || item.oldPath === path
                        );
                        if (change) {
                            path = change.path;
                            type = getFilePreviewType(path);
                            if (!type)
                                throw new PreviewError(
                                    'unavailable',
                                    'Unsupported renamed file type'
                                );
                            deleted = change.status === 'D';
                            if (type.kind !== 'pdf' && type.kind !== 'image') {
                                diff = (
                                    await git(repo, [
                                        ...comparison,
                                        '--relative',
                                        '--no-ext-diff',
                                        '--no-textconv',
                                        '--find-renames',
                                        '--',
                                        change.oldPath,
                                        change.path,
                                    ])
                                ).toString('utf8');
                            }
                        }
                    } catch {
                        diffUnavailable = true;
                    }
                }
                if (deleted) {
                    path = change!.oldPath;
                    if (request.version === 'worktree') version = 'index';
                    else {
                        version = 'commit';
                        if (request.version === 'index') {
                            revision = (
                                await git(repo, [
                                    'rev-parse',
                                    '--verify',
                                    'HEAD',
                                ])
                            )
                                .toString()
                                .trim();
                        } else if (!rootCommit) {
                            revision = (
                                await git(repo, [
                                    'rev-parse',
                                    '--verify',
                                    `${revision}^`,
                                ])
                            )
                                .toString()
                                .trim();
                        }
                    }
                }

                type = getFilePreviewType(path);
                if (!type)
                    throw new PreviewError(
                        'unavailable',
                        'Unsupported preview type'
                    );
                const limit =
                    type.kind === 'pdf' || type.kind === 'image'
                        ? FILE_PREVIEW_BINARY_LIMIT
                        : FILE_PREVIEW_TEXT_LIMIT;
                let data: Buffer;
                if (version === 'worktree') {
                    const target = await realpath(resolve(repo, path));
                    assertWithin(root, target);
                    const handle = await open(
                        target,
                        constants.O_RDONLY |
                            constants.O_NOFOLLOW |
                            constants.O_NONBLOCK
                    );
                    try {
                        const info = await handle.stat();
                        if (!info.isFile())
                            throw new PreviewError(
                                'denied',
                                'Only regular files can be previewed'
                            );
                        if (info.size > limit)
                            throw new PreviewError(
                                'too_large',
                                'File exceeds the preview size limit'
                            );
                        const buffer = Buffer.alloc(
                            Math.min(info.size + 1, limit + 1)
                        );
                        let offset = 0;
                        while (offset < buffer.length) {
                            const result = await handle.read(
                                buffer,
                                offset,
                                buffer.length - offset,
                                offset
                            );
                            if (!result.bytesRead) break;
                            offset += result.bytesRead;
                        }
                        if (offset > info.size)
                            throw new PreviewError(
                                'unavailable',
                                'File changed while being read; retry'
                            );
                        data = buffer.subarray(0, offset);
                    } finally {
                        await handle.close();
                    }
                } else {
                    const listing =
                        version === 'index'
                            ? await git(repo, [
                                  'ls-files',
                                  '--stage',
                                  '-z',
                                  '--',
                                  path,
                              ])
                            : await git(repo, [
                                  'ls-tree',
                                  '-z',
                                  revision!,
                                  '--',
                                  path,
                              ]);
                    const entries = listing
                        .toString('utf8')
                        .split('\0')
                        .filter(Boolean);
                    const entry = entries.find(
                        (item) => item.slice(item.indexOf('\t') + 1) === path
                    );
                    if (!entry)
                        throw new PreviewError(
                            'unavailable',
                            'File is not present in this version'
                        );
                    const [mode, second, third] = entry
                        .slice(0, entry.indexOf('\t'))
                        .split(' ');
                    if (
                        !['100644', '100755'].includes(mode) ||
                        (version === 'index' && third !== '0')
                    ) {
                        throw new PreviewError(
                            'denied',
                            'Symlinks, submodules and conflicted index entries cannot be previewed'
                        );
                    }
                    const oid = version === 'index' ? second : third;
                    const size = Number(
                        (await git(repo, ['cat-file', '-s', oid]))
                            .toString()
                            .trim()
                    );
                    if (!Number.isSafeInteger(size) || size > limit)
                        throw new PreviewError(
                            'too_large',
                            'File exceeds the preview size limit'
                        );
                    data = await git(
                        repo,
                        ['cat-file', 'blob', oid],
                        limit + 1
                    );
                }
                if (data.length > limit)
                    throw new PreviewError(
                        'too_large',
                        'File exceeds the preview size limit'
                    );
                while (
                    cachedBytes + data.length > CACHE_LIMIT &&
                    snapshots.size
                )
                    release(snapshots.keys().next().value!);
                const token = randomUUID();
                const timer = setTimeout(() => release(token), TTL);
                timer.unref();
                snapshots.set(token, { data, timer });
                cachedBytes += data.length;
                return {
                    success: true,
                    token,
                    size: data.length,
                    ...type,
                    version,
                    revision,
                    deleted,
                    path,
                    diff,
                    diffUnavailable,
                    changed: !!change,
                };
            } catch (error) {
                return failure(error);
            }
        },
        async chunk(input: unknown): Promise<FilePreviewChunkResponse> {
            const parsed = filePreviewChunkRequestSchema.safeParse(input);
            if (!parsed.success)
                return failure(
                    new PreviewError('denied', 'Invalid chunk request')
                );
            const { token, offset } = parsed.data;
            const snapshot = snapshots.get(token);
            if (!snapshot)
                return failure(
                    new PreviewError(
                        'expired',
                        'Preview expired; reload the file'
                    )
                );
            if (offset > snapshot.data.length)
                return failure(
                    new PreviewError('denied', 'Invalid chunk offset')
                );
            snapshot.timer.refresh();
            const end = Math.min(
                offset + FILE_PREVIEW_CHUNK_SIZE,
                snapshot.data.length
            );
            return {
                success: true,
                content: snapshot.data.subarray(offset, end).toString('base64'),
                nextOffset: end,
                done: end === snapshot.data.length,
            };
        },
        async close(input: unknown) {
            const parsed = filePreviewChunkRequestSchema.safeParse(input);
            if (parsed.success) release(parsed.data.token);
            return { success: parsed.success };
        },
    };
}
