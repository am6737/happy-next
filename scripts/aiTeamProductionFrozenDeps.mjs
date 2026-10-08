import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
    readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const lockParser = require('@yarnpkg/lockfile');
const semver = require('semver');
const expectedLockSha256 = 'f4e1414c34f5a34cf4d1e388b7059c3aeea3ecd0fc54aedc652ac6159a4b0dae';
const workspaces = ['happy-app', 'happy-cli', 'happy-server', 'happy-voice', 'happy-wire'];
const files = ['package.json', 'yarn.lock', ...workspaces.map((name) => `packages/${name}/package.json`),
    'patches/@expo+prebuild-config+54.0.8.patch', 'patches/.gitignore', 'patches/.keep'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (base, path) => path === base || path.startsWith(`${base}${sep}`);
const ownedRoot = (input) => {
    const path = resolve(input);
    assert.match(path, /^\/tmp\/ai-team-frozen-deps-[A-Za-z0-9]+$/);
    return path;
};
function inventory(base) {
    return files.map((path) => {
        const full = join(base, path);
        const stat = lstatSync(full);
        assert.equal(stat.isFile(), true, `Required release metadata is not regular: ${path}`);
        return { path, mode: stat.mode & 0o777, sha256: sha256(readFileSync(full)) };
    });
}
function writeExclusive(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
function readPrepared(root) {
    const prepared = JSON.parse(readFileSync(join(root, 'input-inventory.json'), 'utf8'));
    assert.equal(prepared.format, 'happy-ai-team-frozen-inputs-v1');
    assert.deepEqual(inventory(root), prepared.files, 'Isolated metadata changed');
    assert.equal(sha256(readFileSync(join(root, 'yarn.lock'))), expectedLockSha256,
        'Formal root lock hash differs');
    return prepared;
}
function resolvePackage(start, name, root) {
    let current = start;
    for (;;) {
        const candidate = join(current, 'node_modules', name);
        if (existsSync(candidate)) {
            const actual = realpathSync(candidate);
            assert.ok(within(root, actual), `Installed dependency escapes isolated tree: ${name}`);
            return actual;
        }
        if (current === root) return null;
        const parent = dirname(current);
        if (!within(root, parent) || parent === current) return null;
        current = parent;
    }
}
function installedPackages(root) {
    const seen = new Set();
    const result = [];
    const scan = (directory) => {
        const nodeModules = join(directory, 'node_modules');
        if (!existsSync(nodeModules)) return;
        for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const names = entry.name.startsWith('@')
                ? readdirSync(join(nodeModules, entry.name)).map((child) => `${entry.name}/${child}`)
                : [entry.name];
            for (const name of names) {
                const full = join(nodeModules, name);
                const actual = realpathSync(full);
                assert.ok(within(root, actual), `Installed package escapes isolated tree: ${name}`);
                if (seen.has(actual)) continue;
                seen.add(actual);
                const manifest = JSON.parse(readFileSync(join(actual, 'package.json'), 'utf8'));
                result.push({ path: actual, name: manifest.name, version: manifest.version,
                    dependencies: manifest.dependencies ?? {}, optionalDependencies: manifest.optionalDependencies ?? {},
        peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} });
                scan(actual);
            }
        }
    };
    scan(root);
    for (const workspace of workspaces) {
        const path = join(root, 'packages', workspace);
        if (!seen.has(path)) {
            const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
            result.push({ path, name: manifest.name, version: manifest.version,
                dependencies: manifest.dependencies ?? {}, optionalDependencies: manifest.optionalDependencies ?? {},
                peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} });
            scan(path);
        }
    }
    return result;
}
function verifyGraph(root) {
    const lock = lockParser.parse(readFileSync(join(root, 'yarn.lock'), 'utf8'));
    assert.equal(lock.type, 'success', 'Yarn lock parse failed');
    const workspaceVersions = new Map(workspaces.map((name) => {
        const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
        return [manifest.name, manifest.version];
    }));
    const packages = installedPackages(root);
    const summary = { packageInstances: packages.length, runtimeEdges: 0, optionalEdges: 0,
        missingRuntime: 0, wrongResolution: 0, missingLockSelector: 0, manifestLockRangeDrift: 0,
        missingOptional: 0, peerEdges: 0, missingPeer: 0, optionalPeerMissing: 0,
        incompatiblePeer: 0, optionalPeerIncompatible: 0, invalidPeerRange: 0, examples: {} };
    const issue = (kind, from, to, expected, actual, path) => {
        summary[kind]++;
        summary.examples[kind] ??= [];
        if (summary.examples[kind].length < 12)
            summary.examples[kind].push({ from, to, expected, actual, path: relative(root, path) });
    };
    for (const pkg of packages) {
        for (const [kind, dependencies] of [['runtime', pkg.dependencies], ['optional', pkg.optionalDependencies]]) {
            for (const [name, range] of Object.entries(dependencies)) {
                if (kind === 'runtime') summary.runtimeEdges++;
                else summary.optionalEdges++;
                const resolved = resolvePackage(pkg.path, name, root);
                if (!resolved) {
                    if (kind === 'runtime') issue('missingRuntime', `${pkg.name}@${pkg.version}`, name, range, null, pkg.path);
                    else summary.missingOptional++;
                    continue;
                }
                const actual = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf8'));
                const workspaceVersion = workspaceVersions.get(name);
                if (workspaceVersion && actual.version === workspaceVersion && resolved.startsWith(`${root}/packages/`)) continue;
                let locked = lock.object[`${name}@${range}`];
                if (!locked) {
                    const parentLock = Object.entries(lock.object).find(([selector, entry]) =>
                        selector.startsWith(`${pkg.name}@`) && entry.version === pkg.version
                        && (entry.dependencies?.[name] || entry.optionalDependencies?.[name]));
                    const lockRange = parentLock?.[1].dependencies?.[name]
                        ?? parentLock?.[1].optionalDependencies?.[name];
                    locked = lockRange ? lock.object[`${name}@${lockRange}`] : null;
                    if (locked && locked.version === actual.version)
                        issue('manifestLockRangeDrift', `${pkg.name}@${pkg.version}`, name,
                            `${range} (lock: ${lockRange})`, actual.version, pkg.path);
                }
                if (!locked) issue('missingLockSelector', `${pkg.name}@${pkg.version}`, name, range, actual.version, pkg.path);
                else if (actual.version !== locked.version)
                    issue('wrongResolution', `${pkg.name}@${pkg.version}`, name, locked.version, actual.version, pkg.path);
            }
        }
        for (const [name, range] of Object.entries(pkg.peerDependencies)) {
            summary.peerEdges++;
            const resolved = resolvePackage(pkg.path, name, root);
            if (!resolved) {
                issue(pkg.peerDependenciesMeta[name]?.optional ? 'optionalPeerMissing' : 'missingPeer',
                    `${pkg.name}@${pkg.version}`, name, range, null, pkg.path);
                continue;
            }
            const actual = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf8'));
            if (!semver.validRange(range))
                issue('invalidPeerRange', `${pkg.name}@${pkg.version}`, name, range, actual.version, pkg.path);
            else if (!semver.satisfies(actual.version, range, { includePrerelease: true }))
                issue(pkg.peerDependenciesMeta[name]?.optional ? 'optionalPeerIncompatible' : 'incompatiblePeer',
                    `${pkg.name}@${pkg.version}`, name, range, actual.version, pkg.path);
        }
    }
    return { lockSelectors: Object.keys(lock.object).length, ...summary,
        runtimeVerified: summary.missingRuntime === 0 && summary.wrongResolution === 0
            && summary.missingLockSelector === 0,
        peerCompatible: summary.missingPeer === 0 && summary.incompatiblePeer === 0
            && summary.invalidPeerRange === 0 };
}

const [mode, path, reportArg] = process.argv.slice(2);
if (!['prepare', 'install', 'verify'].includes(mode) || !path || process.argv.length > 5
    || (reportArg && mode !== 'verify'))
    throw new Error('Usage: aiTeamProductionFrozenDeps.mjs prepare|install|verify /tmp/ai-team-frozen-deps-ID [REPORT.json for verify]');
const target = ownedRoot(path);
if (mode !== 'prepare') {
    const targetStat = lstatSync(target);
    assert.ok(targetStat.isDirectory() && !targetStat.isSymbolicLink(),
        'Owned fresh root must be a real directory');
}
const reportPath = reportArg ? resolve(reportArg) : join(target, 'verification-report-v3.json');
if (mode === 'verify') {
    assert.equal(dirname(reportPath), target, 'Report must be directly inside the owned fresh tree');
    assert.match(basename(reportPath), /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);
}
if (mode === 'prepare') {
    assert.equal(existsSync(target), false, 'Owned target must be new');
    assert.equal(sha256(readFileSync(join(sourceRoot, 'yarn.lock'))), expectedLockSha256);
    const source = inventory(sourceRoot);
    mkdirSync(target, { mode: 0o700 });
    for (const item of source) {
        const destination = join(target, item.path);
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        copyFileSync(join(sourceRoot, item.path), destination);
        chmodSync(destination, item.mode);
    }
    assert.deepEqual(inventory(target), source);
    writeExclusive(join(target, 'input-inventory.json'), {
        format: 'happy-ai-team-frozen-inputs-v1', sourceRoot, files: source,
        inventorySha256: sha256(JSON.stringify(source)), lockSha256: expectedLockSha256,
        scope: 'workspace manifests, root lock, patch metadata only; no sources or credentials' });
    console.log(JSON.stringify({ prepared: target, files: source.length,
        inventorySha256: sha256(JSON.stringify(source)), lockSha256: expectedLockSha256 }));
} else if (mode === 'install') {
    readPrepared(target);
    assert.equal(existsSync(join(target, 'install-evidence.json')), false);
    const home = join(target, '.home');
    const cache = join(target, '.yarn-cache');
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(cache, { mode: 0o700 });
    const started = Date.now();
    const result = spawnSync('yarn', ['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'], {
        cwd: target, encoding: 'utf8', timeout: 900_000, maxBuffer: 5_000_000,
        env: { ...process.env, HOME: home, YARN_CACHE_FOLDER: cache,
            npm_config_userconfig: '/dev/null' },
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const errors = output.split('\n').filter((line) => /^(?:error|ERR!|Error:)/i.test(line))
        .slice(0, 12).map((line) => line.replace(/https?:\/\/\S+/g, '[url]')
            .replace(/(?:token|password|authorization)\s*[:=]\s*\S+/gi, '[redacted]')).map((line) => line.slice(0, 400));
    const evidence = { format: 'happy-ai-team-frozen-install-v1', command: 'yarn install --frozen-lockfile --ignore-scripts --non-interactive',
        yarnVersion: spawnSync('yarn', ['--version'], { encoding: 'utf8', timeout: 5000 }).stdout.trim(),
        exitCode: result.status, signal: result.signal, elapsedMs: Date.now() - started,
        outputSha256: sha256(output), errorLines: errors, scriptsIgnored: true,
        noSharedNodeModulesLink: !existsSync(join(target, 'node_modules'))
            || !lstatSync(join(target, 'node_modules')).isSymbolicLink(),
        sourceInputsStillMatch: JSON.stringify(inventory(sourceRoot)) === JSON.stringify(inventory(target)) };
    writeExclusive(join(target, 'install-evidence.json'), evidence);
    console.log(JSON.stringify(evidence));
    if (result.status !== 0 || !evidence.sourceInputsStillMatch || !evidence.noSharedNodeModulesLink) process.exitCode = 1;
} else {
    const prepared = readPrepared(target);
    const install = JSON.parse(readFileSync(join(target, 'install-evidence.json'), 'utf8'));
    assert.equal(install.format, 'happy-ai-team-frozen-install-v1');
    assert.equal(install.exitCode, 0, 'Frozen Yarn install failed');
    const sourceNow = inventory(sourceRoot);
    const sourceInputsStable = JSON.stringify(sourceNow) === JSON.stringify(prepared.files);
    const graph = verifyGraph(target);
    const report = { format: 'happy-ai-team-frozen-deps-v1', root: target,
        inputInventorySha256: prepared.inventorySha256, lockSha256: expectedLockSha256,
        sourceInputsStable, isolatedInputsStable: true, install,
        graph, sourceBuildVerified: false, patchApplied: false,
        publishedImageVerified: false, providerVerified: false,
        ready: sourceInputsStable && graph.runtimeVerified && graph.peerCompatible };
    writeExclusive(reportPath, report);
    console.log(JSON.stringify({ report: reportPath,
        ready: report.ready, installedPackages: graph.packageInstances,
        runtimeEdges: graph.runtimeEdges, peerEdges: graph.peerEdges,
        graph: { runtimeVerified: graph.runtimeVerified, peerCompatible: graph.peerCompatible,
            missingRuntime: graph.missingRuntime, wrongResolution: graph.wrongResolution,
            missingLockSelector: graph.missingLockSelector, missingPeer: graph.missingPeer,
            incompatiblePeer: graph.incompatiblePeer, invalidPeerRange: graph.invalidPeerRange,
            optionalPeerIncompatible: graph.optionalPeerIncompatible,
            manifestLockRangeDrift: graph.manifestLockRangeDrift } }));
    if (!report.ready) process.exitCode = 1;
}
