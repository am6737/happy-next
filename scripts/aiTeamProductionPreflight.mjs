import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryTree, inventoryFile, inventoryAlternativeFiles, validateReleaseScriptPath,
    inventoryMigrations } from './aiTeamProductionTree.mjs';
import { readArtifactContext, verifyFreshArtifactBinding } from './aiTeamProductionArtifactBinding.mjs';
import { compatibilityEvidenceExpected, verifyCompatibilityEvidenceV2 } from './aiTeamProductionCompatibilityEvidence.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const freshFlags = ['--source-snapshot', '--artifact-root', '--fresh-build-report', '--app-web-report'];
const allowed = new Set(['--write', '--check', '--evidence', '--strict', '--artifact-context', ...freshFlags]);
if (args.some((arg, i) => arg.startsWith('--') && !allowed.has(arg))
    || (args.includes('--write') && !option('--write'))
    || (args.includes('--check') && !option('--check'))
    || (args.includes('--evidence') && !option('--evidence'))
    || (args.includes('--write') && args.includes('--check'))
    || (args.includes('--artifact-context') && (!option('--artifact-context')
        || freshFlags.some((flag) => args.includes(flag))))
    || (freshFlags.some((flag) => args.includes(flag))
        && !freshFlags.every((flag) => option(flag)))) {
    console.error('Usage: node scripts/aiTeamProductionPreflight.mjs [--write PATH | --check PATH] [--evidence PATH] [--strict] [--artifact-context FILE | --source-snapshot FILE --artifact-root ROOT --fresh-build-report FILE --app-web-report FILE]');
    process.exit(2);
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashFile = (path) => digest(readFileSync(join(root, path)));
const sourceManifest = (dir) => inventoryTree(root, join(root, dir)).files;
const packages = Object.fromEntries(['happy-app', 'happy-cli', 'happy-server', 'happy-voice', 'happy-wire'].map((name) => {
    const path = `packages/${name}/package.json`;
    const pkg = JSON.parse(readFileSync(join(root, path), 'utf8'));
    const code = sourceManifest(`packages/${name}/${name === 'happy-wire' || name === 'happy-cli' ? 'src' : 'sources'}`);
    return [name, { version: pkg.version, packageJsonSha256: hashFile(path),
        sourceFiles: code.length, sourceTreeSha256: digest(JSON.stringify(code)) }];
}));
const wireSources = sourceManifest('packages/happy-wire/src');
const releaseInputs = [
    'package.json', 'yarn.lock', '.dockerignore', 'docker-compose.yml', 'Dockerfile.server', 'Dockerfile.webapp',
    'entrypoint.sh',
    'packages/happy-voice/Dockerfile', 'packages/happy-voice/yarn.lock', 'packages/happy-voice/tsconfig.json',
    'packages/happy-server/prisma/schema.prisma',
    'packages/happy-server/prisma/migrations/migration_lock.toml',
    'packages/happy-server/tsconfig.json',
    'packages/happy-cli/tsconfig.json', 'packages/happy-cli/bin/happy.mjs',
    'packages/happy-cli/scripts/ai-team-p0-real-e2e.mjs',
    'packages/happy-app/tsconfig.json', 'packages/happy-app/babel.config.js',
    'packages/happy-app/metro.config.js', 'packages/happy-app/doopush.config.js',
    'packages/happy-app/eas.json',
    'packages/happy-app/expo-env.d.ts', 'packages/happy-app/nativewind-env.d.ts',
    'packages/happy-app/.dockerignore', 'packages/happy-app/index.ts', 'packages/happy-app/logo.png',
    'packages/happy-app/google-services.json', 'packages/happy-wire/tsconfig.json',
    'scripts/aiTeamProductionPreflight.mjs', 'scripts/aiTeamProductionTree.mjs',
    'scripts/aiTeamProductionMigrationTreeTest.mjs',
    'scripts/aiTeamProductionFrozenDeps.mjs', 'scripts/aiTeamProductionSourceSnapshot.mjs',
    'scripts/aiTeamProductionArtifactBinding.mjs',
    'scripts/aiTeamProductionCompatibilityEvidence.mjs',
    'scripts/aiTeamProductionCompatibilityProduce.mjs',
    'scripts/aiHumanTrustSign.mjs', 'docs/ai-team-human-enrollment-operations.zh-CN.md',
    'scripts/verifyAiTeamDatabaseRestore.mts', 'scripts/verifyAiTeamCompatibilityReal.mts',
    'scripts/aiTeamCompatibilityAckBarrier.cjs',
    'scripts/verifyAiTeamCapacityReal.mts',
    'scripts/verifyAiTeamIntegration.mjs',
    'monitoring/prometheus.yml', 'monitoring/ai-team-alerts.yml', 'monitoring/ai-team-alerts.test.yml',
    'scripts/verifyAiTeamAlertsReal.mts', 'docs/ai-team-alerts.zh-CN.md',
].map((path) => inventoryFile(root, path));
const appConfigEntrypoints = inventoryAlternativeFiles(root,
    ['packages/happy-app/app.config.js', 'packages/happy-app/app.config.ts',
        'packages/happy-app/app.json']);
const patchTrees = ['patches', 'packages/happy-app/patches'].map((path) => ({ path,
    state: existsSync(join(root, path)) ? 'present' : 'missing',
    inventory: existsSync(join(root, path)) ? inventoryTree(root, join(root, path),
        { allowInternalFileSymlinks: true }) : null }));
const appBuildTrees = ['packages/happy-app/public', 'packages/happy-app/plugins',
    'packages/happy-app/modules'].map((path) => ({ path,
    state: existsSync(join(root, path)) ? 'present' : 'missing',
    inventory: existsSync(join(root, path)) ? inventoryTree(root, join(root, path)) : null }));
const scriptTrees = ['scripts', 'packages/happy-cli/scripts', 'packages/happy-app/scripts',
    'packages/happy-server/scripts'].map((path) => ({ path,
    state: existsSync(join(root, path)) ? 'present' : 'missing',
    inventory: existsSync(join(root, path)) ? inventoryTree(root, join(root, path),
        { validatePath: validateReleaseScriptPath }) : null }));
const cliRuntimeTrees = ['packages/happy-cli/bin', 'packages/happy-cli/tools'].map((path) => ({ path,
    state: existsSync(join(root, path)) ? 'present' : 'missing',
    inventory: existsSync(join(root, path)) ? inventoryTree(root, join(root, path),
        { validatePath: validateReleaseScriptPath }) : null }));
const cliManifest = JSON.parse(readFileSync(join(root, 'packages/happy-cli/package.json'), 'utf8'));
const cliBinFiles = new Set(cliRuntimeTrees[0].inventory?.files.map((file) => file.path) ?? []);
const cliBinEntrypoints = Object.entries(cliManifest.bin ?? {}).map(([command, entrypoint]) => ({
    command, path: `packages/happy-cli/${entrypoint.replace(/^\.\//, '')}`,
    present: entrypoint.startsWith('./bin/')
        && cliBinFiles.has(`packages/happy-cli/${entrypoint.slice(2)}`),
}));
const cliRuntimeReady = cliRuntimeTrees.every((tree) => tree.state === 'present'
    && tree.inventory.files.length > 0) && cliBinEntrypoints.length > 0
    && cliBinEntrypoints.every((entry) => entry.present);
const context = option('--artifact-context') ? readArtifactContext(option('--artifact-context'), root)
    : freshFlags.every((flag) => option(flag)) ? {
        sourceSnapshot: option('--source-snapshot'), artifactRoot: option('--artifact-root'),
        freshBuildReport: option('--fresh-build-report'), appWebReport: option('--app-web-report'),
    } : null;
const artifactBinding = context ? verifyFreshArtifactBinding(root, context) : null;
function artifact(dir) {
    const path = join(root, dir);
    if (!existsSync(path)) return { state: 'missing', files: 0, sha256: null, provenance: 'unknown' };
    if (!lstatSync(path).isDirectory()) throw new Error(`ARTIFACT_NOT_DIRECTORY: ${dir}`);
    const inventory = inventoryTree(root, path);
    return { state: inventory.files.length ? 'present' : 'empty', files: inventory.files.length,
        sha256: inventory.sha256, provenance: 'unknown' };
}
const artifacts = { wireDist: artifactBinding?.artifacts.wireDist ?? artifact('packages/happy-wire/dist'),
    cliDist: artifactBinding?.artifacts.cliDist ?? artifact('packages/happy-cli/dist'),
    appWebDist: artifactBinding?.artifacts.appWebDist ?? artifact('packages/happy-app/dist'),
    server: { state: 'source-runtime', sha256: null, provenance: 'tsx source; image unknown' },
    voice: { state: 'source-runtime', sha256: null, provenance: 'image unknown' } };
const migrationRoot = join(root, 'packages/happy-server/prisma/migrations');
const migrationInventory = inventoryMigrations(root, migrationRoot);
const migrations = migrationInventory.entries;
const migrationInventoryComplete = migrationInventory.complete;
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--untracked-files=all').length > 0;
const manifest = {
    format: 'happy-ai-team-release-candidate-v2', gitHead: git('rev-parse', 'HEAD'), dirty,
    packages, releaseInputs, appConfigEntrypoints, patchTrees, appBuildTrees, scriptTrees,
    cliRuntimeTrees, cliBinEntrypoints, artifactBinding,
    releaseInputsSha256: digest(JSON.stringify({ releaseInputs, appConfigEntrypoints,
        patchTrees, appBuildTrees, scriptTrees, cliRuntimeTrees, cliBinEntrypoints })), artifacts,
    wire: { sourceFiles: wireSources, sourceSha256: digest(JSON.stringify(wireSources)) },
    migrations: { count: migrations.length, inventoryComplete: migrationInventoryComplete,
        manifestSha256: migrationInventory.sha256, entries: migrations },
    compatibility: { state: 'unknown', rule: 'exact candidate digest only; mixed CLI/server versions require separate HTTP/RPC tests',
        migrationRule: 'separate migration job; expand-before-contract; no automatic down migration',
        minimumProvenCliVersion: null, minimumProvenAppVersion: null },
};
const candidateSha256 = digest(JSON.stringify(manifest));
const requiredChecks = ['wire-build', 'old-cli-new-server', 'new-cli-old-server', 'app-server', 'isolated-db-restore', 'migration-plan-review'];
function verifyEvidence(path) {
    try {
        const evidencePath = resolve(path);
        const evidenceStat = lstatSync(evidencePath);
        if (!evidenceStat.isFile() || evidenceStat.isSymbolicLink()
            || realpathSync(evidencePath) !== evidencePath
            || evidenceStat.size > 2_000_000) return false;
        const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
        if (evidence.format === 'happy-ai-team-compatibility-evidence-v2') {
            if (!artifactBinding || !context || !evidencePath.startsWith('/tmp/')) return false;
            const expected = compatibilityEvidenceExpected({ candidateSha256,
                migrationManifestSha256: manifest.migrations.manifestSha256,
                migrationCount: manifest.migrations.count,
                migrationInventoryComplete }, artifactBinding, context,
            hashFile('scripts/aiTeamProductionCompatibilityProduce.mjs'));
            return verifyCompatibilityEvidenceV2(evidence, expected);
        }
        // Legacy evidence is retained for historical diagnostics only. Strict
        // admission requires v2's actual component identity and business proofs.
        if (args.includes('--strict')) return false;
        if (evidence.format !== 'happy-ai-team-compatibility-evidence-v1'
            || evidence.candidateSha256 !== candidateSha256 || !Array.isArray(evidence.reports)) return false;
        const seen = new Set();
        for (const report of evidence.reports) {
            if (!requiredChecks.includes(report.check) || seen.has(report.check)
                || !/^[A-Za-z0-9._-]+\.json$/.test(report.file)
                || !/^[0-9a-f]{64}$/.test(report.sha256)) return false;
            seen.add(report.check);
            const bytes = readFileSync(join(dirname(resolve(path)), report.file));
            if (bytes.length > 1_000_000 || digest(bytes) !== report.sha256) return false;
            const result = JSON.parse(bytes.toString('utf8'));
            if (result.format !== 'happy-ai-team-check-v1' || result.candidateSha256 !== candidateSha256
                || result.check !== report.check || result.exitCode !== 0 || result.result !== 'passed'
                || (artifactBinding && result.artifactContextSha256 !== artifactBinding.contextSha256)
                || typeof result.command !== 'string' || !result.command.trim()
                || typeof result.completedAt !== 'string' || !Number.isFinite(Date.parse(result.completedAt))) return false;
            if (report.check === 'old-cli-new-server' || report.check === 'new-cli-old-server') {
                if (result.harnessSha256 !== hashFile('scripts/verifyAiTeamCompatibilityReal.mts')
                    || !/^[0-9a-f]{40}$/.test(result.oldRevision)
                    || result.logFile !== 'harness-log.json' || result.matrixFile !== 'matrix.json'
                    || !/^[0-9a-f]{64}$/.test(result.logSha256)
                    || !/^[0-9a-f]{64}$/.test(result.matrixSha256)) return false;
                const directory = dirname(resolve(path));
                const log = readFileSync(join(directory, result.logFile));
                const matrixBytes = readFileSync(join(directory, result.matrixFile));
                if (log.length > 1_000_000 || matrixBytes.length > 1_000_000
                    || digest(log) !== result.logSha256
                    || digest(matrixBytes) !== result.matrixSha256) return false;
                const matrix = JSON.parse(matrixBytes.toString('utf8'));
                if (matrix.format !== 'happy-ai-team-compatibility-harness-v1'
                    || matrix.candidateSha256 !== candidateSha256 || matrix.candidateStable !== true
                    || (artifactBinding && matrix.artifactContextSha256 !== artifactBinding.contextSha256)
                    || matrix.rpc !== 'verified-daemon'
                    || matrix.oldRevision !== result.oldRevision
                    || matrix.harnessSha256 !== result.harnessSha256
                    || matrix.logSha256 !== result.logSha256
                    || !matrix.results?.some((entry) => entry.check === report.check
                        && entry.result === 'passed')) return false;
            }
        }
        return requiredChecks.every((check) => seen.has(check));
    } catch { return false; }
}
const artifactConsistencyReady = !dirty && releaseInputs.every((item) => item.sha256)
    && migrationInventoryComplete
    && appConfigEntrypoints.ready
    && [...patchTrees, ...appBuildTrees].every((tree) => tree.state === 'present')
    && scriptTrees.every((tree) => tree.state === 'present')
    && cliRuntimeReady
    && artifacts.wireDist.state === 'present' && artifacts.cliDist.state === 'present'
    && (!context || artifactBinding !== null);
const compatibilityEvidenceReady = option('--evidence') ? verifyEvidence(option('--evidence')) : false;
const audit = { artifactConsistencyReady, compatibilityEvidenceReady, productionReady: false,
    reasons: [...(dirty ? ['dirty_worktree'] : []), ...(!releaseInputs.every((item) => item.sha256) ? ['release_input_missing'] : []),
        ...(!migrationInventoryComplete ? ['migration_inventory_incomplete'] : []),
        ...(!appConfigEntrypoints.ready ? ['app_config_entrypoint_missing'] : []),
        ...(!patchTrees.every((tree) => tree.state === 'present') ? ['patch_tree_missing'] : []),
        ...(!appBuildTrees.every((tree) => tree.state === 'present') ? ['app_build_tree_missing'] : []),
        ...(!scriptTrees.every((tree) => tree.state === 'present') ? ['release_script_tree_missing'] : []),
        ...(!cliRuntimeReady ? ['cli_runtime_tree_incomplete'] : []),
        ...(artifacts.wireDist.state !== 'present' ? ['wire_dist_missing'] : []),
        ...(artifacts.cliDist.state !== 'present' ? ['cli_dist_missing'] : []),
        ...(!compatibilityEvidenceReady ? ['compatibility_evidence_unknown'] : [])],
    candidateSha256, artifactContextSha256: artifactBinding?.contextSha256 ?? null,
    artifactRuntimeRoot: artifactBinding?.artifactRoot ?? null,
    head: manifest.gitHead, migrationCount: migrations.length,
    migrationInventoryComplete,
    migrationManifestSha256: manifest.migrations.manifestSha256, wireSourceSha256: manifest.wire.sourceSha256 };
if (option('--write')) writeFileSync(resolve(option('--write')), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
if (option('--check')) {
    const expected = JSON.parse(readFileSync(resolve(option('--check')), 'utf8'));
    if (JSON.stringify(expected) !== JSON.stringify(manifest)) {
        console.error('PREFLIGHT_MANIFEST_MISMATCH');
        process.exitCode = 1;
    }
}
console.log(JSON.stringify(audit));
if (args.includes('--strict') && (!artifactConsistencyReady || !compatibilityEvidenceReady)) process.exitCode = 1;
