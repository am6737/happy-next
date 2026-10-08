import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
    symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryFile, inventoryTree } from './aiTeamProductionTree.mjs';

const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inventorySha = (files) => sha(JSON.stringify(files));
const present = (path) => {
    try { lstatSync(path); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const packages = ['happy-app', 'happy-cli', 'happy-server', 'happy-voice', 'happy-wire'];
const directories = [
    'patches', 'monitoring', 'scripts',
    'packages/happy-app/sources', 'packages/happy-app/public',
    'packages/happy-app/plugins', 'packages/happy-app/modules', 'packages/happy-app/patches',
    'packages/happy-app/scripts',
    'packages/happy-cli/src', 'packages/happy-cli/bin', 'packages/happy-cli/scripts', 'packages/happy-cli/tools',
    'packages/happy-server/sources', 'packages/happy-server/prisma', 'packages/happy-server/scripts',
    'packages/happy-voice/sources', 'packages/happy-wire/src',
];
const rootFiles = ['package.json', 'yarn.lock', 'Dockerfile.server', 'Dockerfile.webapp',
    '.dockerignore', '.gitignore', 'docker-compose.yml', 'entrypoint.sh', 'README.md', 'LICENSE',
    'docs/ai-team-human-enrollment-operations.zh-CN.md'];
const packageFiles = ['package.json', 'tsconfig.json', 'vitest.config.ts', 'vitest.integration.config.ts',
    'babel.config.js', 'metro.config.js', 'app.config.js', 'app.config.ts', 'app.json', 'doopush.config.js',
    'eas.json', '.dockerignore', 'index.ts', 'logo.png', 'google-services.json',
    'nativewind-env.d.ts', 'expo-env.d.ts', 'Dockerfile', 'yarn.lock', 'README.md', 'LICENSE'];
const validateInputPath = (path) => {
    assert.ok(!path.split('/').some((part) =>
        ['node_modules', '.git', '.npmrc', '.yarnrc', 'auth.json', 'credentials.json', 'access.key'].includes(part)
        || part.startsWith('.env')), `Forbidden snapshot input: ${path}`);
};

function inventory(root) {
    const files = new Map();
    for (const path of [...rootFiles, ...packages.flatMap((name) =>
        packageFiles.map((file) => `packages/${name}/${file}`))]) {
        validateInputPath(path);
        const entry = inventoryFile(root, path);
        if (entry.state === 'present') {
            const { state, ...file } = entry;
            files.set(path, file);
        }
    }
    for (const path of directories) {
        assert.ok(existsSync(join(root, path)), `Required source directory missing: ${path}`);
        for (const file of inventoryTree(root, join(root, path), {
            allowInternalFileSymlinks: path === 'patches' || path.endsWith('/patches'),
            validatePath: validateInputPath,
        }).files) {
            files.set(file.path, file);
        }
    }
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// The preflight uses the same complete inventory as materialization. Importing
// this module must not execute the snapshot CLI or create any files.
export { inventory as inventoryProductionSources };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const [mode, reportArg, targetArg, ...extra] = process.argv.slice(2);
assert.ok(['prepare', 'materialize', 'check'].includes(mode) && reportArg && extra.length === 0,
    'Usage: node scripts/aiTeamProductionSourceSnapshot.mjs prepare REPORT | materialize REPORT FRESH_ROOT | check REPORT');
assert.equal(Boolean(targetArg), mode === 'materialize');
const reportPath = resolve(reportArg);
assert.match(reportPath, /^\/tmp\/ai-team-source-snapshot-[A-Za-z0-9-]+\.json$/);
if (mode === 'prepare') {
    const before = inventory(sourceRoot);
    assert.equal(inventorySha(inventory(sourceRoot)), inventorySha(before), 'Sources changed during snapshot');
    const report = { format: 'happy-ai-team-source-snapshot-v1', sourceRoot,
        files: before, sourceSha256: inventorySha(before),
        excludes: ['credentials', 'existing dist', 'node_modules', 'native signing/build directories'],
        sourceBuildVerified: false };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ report: reportPath, files: before.length, sourceSha256: report.sourceSha256 }));
} else {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.format, 'happy-ai-team-source-snapshot-v1');
    assert.equal(report.sourceRoot, sourceRoot);
    assert.equal(inventorySha(report.files), report.sourceSha256);
    const current = inventory(sourceRoot);
    assert.equal(inventorySha(current), report.sourceSha256, 'Sources changed after snapshot');
    if (mode === 'materialize') {
        const target = resolve(targetArg);
        assert.match(target, /^\/tmp\/ai-team-frozen-deps-[A-Za-z0-9]+$/);
        assert.ok(lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink());
        const prepared = JSON.parse(readFileSync(join(target, 'input-inventory.json'), 'utf8'));
        assert.equal(prepared.format, 'happy-ai-team-frozen-inputs-v1');
        assert.equal(prepared.sourceRoot, sourceRoot);
        const install = JSON.parse(readFileSync(join(target, 'install-evidence.json'), 'utf8'));
        assert.equal(install.format, 'happy-ai-team-frozen-install-v1');
        assert.equal(install.exitCode, 0, 'Fresh dependency installation did not pass');
        assert.ok(lstatSync(join(target, 'node_modules')).isDirectory()
            && !lstatSync(join(target, 'node_modules')).isSymbolicLink(), 'Shared dependencies are forbidden');
        for (const name of packages) assert.equal(present(join(target, 'packages', name, 'dist')),
            false, 'Fresh source destination has pre-existing build artifacts');
        for (const item of prepared.files) {
            const matching = current.find((entry) => entry.path === item.path);
            assert.ok(matching && !matching.target);
            assert.equal(matching.sha256, item.sha256, `Fresh metadata changed: ${item.path}`);
            assert.equal(matching.mode, item.mode);
            const stat = lstatSync(join(target, item.path));
            assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Fresh metadata is not a regular file');
            assert.equal(stat.mode & 0o777, item.mode);
            assert.equal(sha(readFileSync(join(target, item.path))), item.sha256);
        }
        assert.equal(present(join(target, 'source-snapshot.json')), false, 'Fresh source tree already materialized');
        const startedPath = join(target, 'source-materialization-started.json');
        assert.equal(present(startedPath), false,
            'Source materialization already started; use a new fresh dependency tree');
        // Check all destinations before writing; existing files may only be exact prepared metadata.
        const preparedPaths = new Set(prepared.files.map((item) => item.path));
        for (const item of current) {
            const destination = join(target, item.path);
            let ancestor = dirname(destination);
            while (ancestor !== target) {
                if (present(ancestor)) assert.ok(lstatSync(ancestor).isDirectory()
                    && !lstatSync(ancestor).isSymbolicLink(), 'Snapshot destination ancestor is unsafe');
                ancestor = dirname(ancestor);
            }
            if (present(destination)) assert.ok(preparedPaths.has(item.path),
                `Refusing existing destination: ${item.path}`);
        }
        // Preserve partial copies for diagnosis, but permanently forbid reusing them as fresh input.
        writeFileSync(startedPath, `${JSON.stringify({ sourceSha256: report.sourceSha256,
            startedAt: new Date().toISOString(), sourceBuildVerified: false })}\n`, { flag: 'wx', mode: 0o600 });
        try {
            for (const item of current) {
                const destination = join(target, item.path);
                if (preparedPaths.has(item.path)) continue;
                mkdirSync(dirname(destination), { recursive: true });
                if (item.target) symlinkSync(item.target, destination);
                else { copyFileSync(join(sourceRoot, item.path), destination, constants.COPYFILE_EXCL);
                    chmodSync(destination, item.mode); }
            }
            assert.equal(inventorySha(inventory(target)), report.sourceSha256, 'Materialized source bytes/modes differ');
            assert.equal(inventorySha(inventory(sourceRoot)), report.sourceSha256, 'Sources changed while copying');
            writeFileSync(join(target, 'source-snapshot.json'), `${JSON.stringify(report, null, 2)}\n`,
                { flag: 'wx', mode: 0o600 });
        } catch (error) {
            writeFileSync(join(target, 'source-materialization-failed.json'), `${JSON.stringify({
                sourceSha256: report.sourceSha256, sourceBuildVerified: false,
                errorKind: error instanceof Error ? error.name : 'UnknownError' })}\n`, { flag: 'wx', mode: 0o600 });
            throw error;
        }
        console.log(JSON.stringify({ materialized: target, files: current.length,
            sourceSha256: report.sourceSha256, sourceBuildVerified: false }));
    } else console.log(JSON.stringify({ sourceStable: true, files: current.length,
        sourceSha256: report.sourceSha256, sourceBuildVerified: false }));
}
}
