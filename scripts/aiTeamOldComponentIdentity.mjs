import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => {
    const relativePath = relative(root, path);
    assert.ok(relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)
        && !isAbsolute(relativePath), 'OLD_IDENTITY_PATH_ESCAPE');
    return relativePath.split(sep).join('/');
};
const canonical = (path) => {
    assert.equal(typeof path, 'string');
    assert.ok(path && !path.includes('\0') && !path.includes('\\') && !path.startsWith('/')
        && path === posix.normalize(path)
        && path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'OLD_IDENTITY_NONCANONICAL_MEMBER');
    return path;
};
const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function verifyPublishedNpmTree(packageRootInput, dependencyRoot, expectedIntegrity =
    'sha512-oZnj0gqM0yy/hHMNZtf4LUo9aDHuIOeHf7bBmvvdqQgZ3MWZmjbsIVPF0NQlSwGTstxNCZGXdt3fTd9GwITjXg==') {
    const packageRoot = realpathSync(packageRootInput);
    assert.ok(packageRoot.startsWith('/tmp/ai-team-published-old-')
        && packageRoot.endsWith('/package'), 'OLD_NPM_OWNED_ROOT');
    const archivePath = join(dirname(packageRoot), 'package.tgz');
    assert.ok(lstatSync(archivePath).isFile() && !lstatSync(archivePath).isSymbolicLink());
    const archive = readFileSync(archivePath);
    const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
    assert.equal(integrity, expectedIntegrity, 'OLD_NPM_ARCHIVE_INTEGRITY');
    const require = createRequire(join(dependencyRoot, 'packages/happy-cli/package.json'));
    const tar = require('tar');
    const members = new Map();
    tar.t({ sync: true, file: archivePath, onReadEntry(entry) {
        const full = canonical(entry.path);
        assert.ok(full.startsWith('package/'), 'OLD_NPM_ARCHIVE_ROOT');
        const path = canonical(full.slice('package/'.length));
        assert.ok(!members.has(path) && !['node_modules', 'package-lock.json'].includes(path),
            'OLD_NPM_ARCHIVE_DUPLICATE_OR_INSTALL_INPUT');
        assert.ok(entry.type === 'File' || entry.type === 'SymbolicLink',
            'OLD_NPM_ARCHIVE_ENTRY_TYPE');
        const mode = entry.mode & 0o777;
        if (entry.type === 'SymbolicLink') {
            const target = entry.linkpath;
            assert.equal(typeof target, 'string');
            assert.ok(!isAbsolute(target) && !target.includes('\0'), 'OLD_NPM_LINK_TARGET');
            members.set(path, { path, mode, target });
            entry.resume();
        } else {
            const hash = createHash('sha256');
            entry.on('data', (chunk) => hash.update(chunk));
            entry.once('end', () => {
                members.set(path, { path, mode, sha256: hash.digest('hex') });
            });
            entry.resume();
        }
    } });
    assert.ok(members.size > 0, 'OLD_NPM_EMPTY_ARCHIVE');
    const actualPaths = new Set();
    function walk(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const full = join(directory, entry.name);
            const path = inside(packageRoot, full);
            if (path === 'node_modules') {
                assert.ok(lstatSync(full).isDirectory()
                    && realpathSync(full).startsWith(`${packageRoot}/`),
                'OLD_NPM_DEPENDENCY_ROOT');
                continue;
            }
            if (path === 'package-lock.json') {
                assert.ok(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink(),
                    'OLD_NPM_GENERATED_LOCK');
                continue;
            }
            const stat = lstatSync(full);
            if (stat.isDirectory()) { walk(full); continue; }
            assert.ok(stat.isFile() || stat.isSymbolicLink(), 'OLD_NPM_EXTRA_ENTRY_TYPE');
            assert.ok(members.has(path), `OLD_NPM_EXTRA_EXECUTION_FILE: ${path}`);
            actualPaths.add(path);
        }
    }
    walk(packageRoot);
    assert.equal(actualPaths.size, members.size, 'OLD_NPM_MISSING_MEMBER');
    const rows = [...members.values()].sort((a, b) => a.path.localeCompare(b.path));
    for (const member of rows) {
        const full = join(packageRoot, member.path);
        const stat = lstatSync(full);
        assert.equal(stat.mode & 0o777, member.mode, `OLD_NPM_MEMBER_MODE: ${member.path}`);
        if (Object.hasOwn(member, 'target')) {
            assert.ok(stat.isSymbolicLink(), `OLD_NPM_MEMBER_TYPE: ${member.path}`);
            assert.equal(readlinkSync(full), member.target, `OLD_NPM_MEMBER_LINK: ${member.path}`);
            const target = resolve(dirname(full), member.target);
            const targetPath = inside(packageRoot, target);
            assert.ok(members.has(targetPath) && !Object.hasOwn(members.get(targetPath), 'target')
                && lstatSync(target).isFile() && realpathSync(target).startsWith(`${packageRoot}/`),
            `OLD_NPM_UNSAFE_LINK: ${member.path}`);
        } else {
            assert.ok(stat.isFile() && !stat.isSymbolicLink(), `OLD_NPM_MEMBER_TYPE: ${member.path}`);
            assert.equal(sha256(readFileSync(full)), member.sha256,
                `OLD_NPM_MEMBER_BYTES: ${member.path}`);
        }
    }
    return { packageRoot, archiveSha256: sha256(archive), registryIntegrity: integrity,
        members: rows.length, packedTreeSha256: sha256(JSON.stringify(rows)),
        generatedLockSha256: sha256(readFileSync(join(packageRoot, 'package-lock.json'))),
        dependencyRoot: join(packageRoot, 'node_modules'),
        qualification: 'packed members only; generated package-lock and installed node_modules are separate inputs' };
}

export function verifyOldServerTrackedTree(oldRootInput, revision, gitRoot) {
    assert.match(revision, /^[0-9a-f]{40}$/);
    const oldRoot = realpathSync(oldRootInput);
    assert.ok(oldRoot.startsWith('/tmp/happy-old-agent-prepared-')
        || oldRoot.startsWith('/tmp/ai-team-old-source-')
        || oldRoot.startsWith('/tmp/happy-old-agent-probe-'), 'OLD_SERVER_OWNED_ROOT');
    const actualHead = execFileSync('git', ['rev-parse', 'HEAD'],
        { cwd: oldRoot, encoding: 'utf8' }).trim();
    assert.equal(actualHead, revision, 'OLD_SERVER_HEAD');
    const tree = execFileSync('git', ['ls-tree', '-rz', revision],
        { cwd: gitRoot, maxBuffer: 20_000_000 }).toString('utf8').split('\0').filter(Boolean);
    const rows = [];
    const tracked = new Map();
    for (const entry of tree) {
        const match = /^(100644|100755|120000) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
        assert.ok(match, 'OLD_SERVER_GIT_TREE_ENTRY');
        const [, gitMode, blob, rawPath] = match;
        const path = canonical(rawPath);
        assert.ok(!tracked.has(path), 'OLD_SERVER_DUPLICATE_SOURCE');
        tracked.set(path, gitMode);
        const full = join(oldRoot, path);
        let parent = oldRoot;
        for (const part of path.split('/').slice(0, -1)) {
            parent = join(parent, part);
            assert.ok(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink()
                && realpathSync(parent).startsWith(`${oldRoot}/`),
            `OLD_SERVER_SOURCE_PARENT: ${path}`);
        }
        const stat = lstatSync(full);
        assert.equal(gitMode === '120000' ? stat.isSymbolicLink() : stat.isFile(), true,
            `OLD_SERVER_SOURCE_TYPE: ${path}`);
        const bytes = gitMode === '120000' ? Buffer.from(readlinkSync(full)) : readFileSync(full);
        assert.equal(gitBlob(bytes), blob, `OLD_SERVER_SOURCE_BYTES: ${path}`);
        if (gitMode === '120000') {
            assert.ok(stat.isSymbolicLink(), `OLD_SERVER_SOURCE_TYPE: ${path}`);
            const target = resolve(dirname(full), bytes.toString('utf8'));
            const targetPath = inside(oldRoot, target);
            if (existsSync(target)) {
                const targetStat = lstatSync(target);
                assert.ok(targetStat.isFile() ? tracked.has(targetPath)
                    || tree.some((item) => item.endsWith(`\t${targetPath}`))
                    : targetStat.isDirectory() && tree.some((item) =>
                        item.slice(item.indexOf('\t') + 1).startsWith(`${targetPath}/`)),
                `OLD_SERVER_LINK_UNTRACKED: ${path}`);
                assert.ok(!targetStat.isSymbolicLink()
                    && realpathSync(target).startsWith(`${oldRoot}/`),
                `OLD_SERVER_LINK_ESCAPE: ${path}`);
            } else {
                assert.ok(!path.startsWith('packages/happy-server/sources/')
                    && !path.startsWith('packages/happy-server/prisma/'),
                `OLD_SERVER_DANGLING_EXECUTION_LINK: ${path}`);
            }
        } else {
            assert.ok(stat.isFile() && !stat.isSymbolicLink(), `OLD_SERVER_SOURCE_TYPE: ${path}`);
            assert.equal(Boolean(stat.mode & 0o111), gitMode === '100755',
                `OLD_SERVER_SOURCE_MODE: ${path}`);
        }
        rows.push({ path, gitMode, blob });
    }
    for (const sourceRoot of ['packages/happy-server/sources', 'packages/happy-server/prisma']) {
        const directory = join(oldRoot, sourceRoot);
        function walk(current) {
            for (const entry of readdirSync(current, { withFileTypes: true })) {
                const full = join(current, entry.name);
                const path = inside(oldRoot, full);
                if (lstatSync(full).isDirectory()) walk(full);
                else assert.ok(tracked.has(path), `OLD_SERVER_EXTRA_EXECUTION_SOURCE: ${path}`);
            }
        }
        walk(directory);
    }
    rows.sort((a, b) => a.path.localeCompare(b.path));
    return { oldRoot, revision, trackedFiles: rows.length,
        trackedTreeSha256: sha256(JSON.stringify(rows)),
        sourceBoundary: 'tracked Git blobs/modes and no extra Server source or Prisma files' };
}
