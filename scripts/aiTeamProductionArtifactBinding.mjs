import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { inventoryTree, validateReleaseScriptPath } from './aiTeamProductionTree.mjs';
import { inventoryProductionSources } from './aiTeamProductionSourceSnapshot.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requiredSteps = ['root-patches', 'app-patches-assets', 'cli-tools', 'wire-build',
    'prisma-generate', 'server-typecheck', 'cli-normal-build', 'app-typecheck', 'voice-typecheck'];
const artifactDirectories = { wireDist: 'packages/happy-wire/dist',
    cliDist: 'packages/happy-cli/dist', appWebDist: 'packages/happy-app/dist' };
const expoAssetRoot = 'packages/happy-app/dist/assets/node_modules';
const metadataPaths = ['package.json', 'yarn.lock',
    ...['happy-app', 'happy-cli', 'happy-server', 'happy-voice', 'happy-wire']
        .map((name) => `packages/${name}/package.json`),
    'patches/@expo+prebuild-config+54.0.8.patch', 'patches/.gitignore', 'patches/.keep'];

function regular(path) {
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `BINDING_NOT_REGULAR: ${path}`);
    return readFileSync(path);
}
function json(path, format) {
    const bytes = regular(path);
    assert.ok(bytes.length <= 2_000_000, `BINDING_REPORT_TOO_LARGE: ${path}`);
    const data = JSON.parse(bytes.toString('utf8'));
    assert.equal(data.format, format, `BINDING_REPORT_FORMAT: ${path}`);
    return { data, sha256: sha256(bytes) };
}
function insideFile(root, path, expected) {
    assert.equal(dirname(path), root, `BINDING_REPORT_ROOT: ${path}`);
    if (expected) assert.equal(basename(path), expected);
    return path;
}
export function validateArtifactPath(path) {
    const parts = path.split('/');
    const expoStaticAsset = path.startsWith(`${expoAssetRoot}/`);
    if (path === expoAssetRoot || expoStaticAsset) {
        if (parts.slice(5).some((part) => part === 'node_modules')
            || /\.(?:[cm]?js|[cm]?ts|tsx|json|map|node)$/i.test(parts.at(-1) ?? ''))
            throw new Error(`BINDING_SECRET_ARTIFACT: ${path}`);
    }
    if (parts.some((part, index) => part.startsWith('.env')
        || ['.git', '.npmrc', 'auth.json', 'credentials.json', 'access.key'].includes(part)
        || part === 'node_modules' && !(index === 4 && (path === expoAssetRoot || expoStaticAsset))))
        throw new Error(`BINDING_SECRET_ARTIFACT: ${path}`);
}
export function artifactInventory(root) {
    return Object.fromEntries(Object.entries(artifactDirectories).map(([key, path]) => {
        if (key === 'appWebDist' && existsSync(join(root, expoAssetRoot))) {
            const stat = lstatSync(join(root, expoAssetRoot));
            assert.ok(stat.isDirectory() && !stat.isSymbolicLink(),
                'BINDING_EXPO_ASSET_ROOT_NOT_DIRECTORY');
        }
        const tree = inventoryTree(root, join(root, path), { validatePath: validateArtifactPath });
        assert.ok(tree.files.length > 0, `BINDING_EMPTY_ARTIFACT: ${path}`);
        if (key === 'appWebDist') {
            for (const file of tree.files) {
                if (file.path.startsWith('packages/happy-app/dist/assets/node_modules/'))
                    assert.match(file.path, /\.(?:png|ttf)$/i,
                        `BINDING_NON_STATIC_EXPO_ASSET: ${file.path}`);
            }
        }
        return [key, { state: 'present', files: tree.files.length, sha256: tree.sha256,
            provenance: 'fresh-local-build; unsigned' }];
    }));
}
function sourceInventory(root, expected) {
    const actual = inventoryProductionSources(root);
    assert.equal(sha256(JSON.stringify(actual)), sha256(JSON.stringify(expected)),
        `BINDING_SOURCE_DRIFT: ${root}`);
}
function checkMetadata(sourceRoot, artifactRoot, lockSha256, sourceFiles) {
    const prepared = json(join(artifactRoot, 'input-inventory.json'), 'happy-ai-team-frozen-inputs-v1');
    assert.equal(prepared.data.sourceRoot, sourceRoot);
    assert.equal(prepared.data.lockSha256, lockSha256);
    assert.ok(Array.isArray(prepared.data.files), 'BINDING_METADATA_FILES');
    assert.deepEqual(prepared.data.files.map((item) => item.path), metadataPaths,
        'BINDING_METADATA_PATHS');
    const sourceByPath = new Map(sourceFiles.map((item) => [item.path, item]));
    for (const item of prepared.data.files) {
        assert.equal(typeof item.path, 'string', 'BINDING_METADATA_PATH');
        assert.match(item.path, /^[A-Za-z0-9@._+/-]+$/,
            'BINDING_METADATA_RELATIVE_PATH');
        assert.ok(!item.path.startsWith('/') && item.path === posix.normalize(item.path)
            && item.path.split('/').every((part) => part !== '.' && part !== '..'),
        'BINDING_METADATA_CANONICAL_PATH');
        validateReleaseScriptPath(item.path);
        assert.deepEqual(Object.keys(item).sort(), ['mode', 'path', 'sha256']);
        assert.deepEqual(item, sourceByPath.get(item.path),
            `BINDING_METADATA_SOURCE: ${item.path}`);
    }
    const inventorySha256 = sha256(JSON.stringify(prepared.data.files));
    assert.equal(prepared.data.inventorySha256, inventorySha256,
        'BINDING_METADATA_INVENTORY_SHA');
    for (const item of prepared.data.files) {
        for (const root of [sourceRoot, artifactRoot]) {
            const path = join(root, item.path);
            assert.equal(sha256(regular(path)), item.sha256);
            assert.equal(lstatSync(path).mode & 0o777, item.mode);
        }
    }
    const install = json(join(artifactRoot, 'install-evidence.json'), 'happy-ai-team-frozen-install-v1');
    assert.equal(install.data.exitCode, 0);
    assert.equal(install.data.command,
        'yarn install --frozen-lockfile --ignore-scripts --non-interactive');
    assert.equal(install.data.scriptsIgnored, true);
    assert.equal(install.data.sourceInputsStillMatch, true);
    assert.equal(install.data.noSharedNodeModulesLink, true);
    const graph = json(join(artifactRoot, 'verification-after-patches-root.json'),
        'happy-ai-team-frozen-deps-v1');
    assert.equal(graph.data.ready, true);
    assert.equal(graph.data.root, artifactRoot);
    assert.equal(graph.data.inputInventorySha256, inventorySha256);
    assert.equal(graph.data.sourceInputsStable, true);
    assert.equal(graph.data.isolatedInputsStable, true);
    assert.deepEqual(graph.data.install, install.data);
    assert.equal(graph.data.lockSha256, lockSha256);
    assert.equal(graph.data.graph?.runtimeVerified, true);
    assert.equal(graph.data.graph?.peerCompatible, true);
    for (const key of ['missingRuntime', 'wrongResolution', 'missingLockSelector',
        'missingPeer', 'incompatiblePeer', 'invalidPeerRange'])
        assert.equal(graph.data.graph[key], 0, `BINDING_GRAPH_${key}`);
    return { preparedSha256: prepared.sha256, inventorySha256,
        installSha256: install.sha256,
        graphSha256: graph.sha256 };
}

export function readArtifactContext(path, sourceRoot) {
    const contextPath = resolve(path);
    assert.match(contextPath, /^\/tmp\/ai-team-artifact-context-[A-Za-z0-9-]+\.json$/);
    const context = json(contextPath, 'happy-ai-team-artifact-context-v1');
    assert.equal(context.data.sourceRoot, sourceRoot);
    for (const field of ['sourceSnapshotSha256', 'freshBuildReportSha256',
        'appWebReportSha256', 'installEvidenceSha256', 'graphReportSha256'])
        assert.match(context.data[field], /^[0-9a-f]{64}$/, `BINDING_CONTEXT_${field}`);
    return { ...context.data, contextSha256: context.sha256, contextPath };
}

export function verifyFreshArtifactBinding(sourceRoot, input) {
    const artifactRoot = resolve(input.artifactRoot);
    assert.match(artifactRoot, /^\/tmp\/ai-team-frozen-deps-[A-Za-z0-9]+$/);
    const rootStat = lstatSync(artifactRoot);
    assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'BINDING_ARTIFACT_ROOT');
    const sourceSnapshot = resolve(input.sourceSnapshot);
    assert.match(sourceSnapshot, /^\/tmp\/ai-team-source-snapshot-[A-Za-z0-9-]+\.json$/);
    const buildPath = insideFile(artifactRoot, resolve(input.freshBuildReport),
        'consumer-build-report-root.json');
    const webPath = insideFile(artifactRoot, resolve(input.appWebReport),
        'app-web-build-report-root.json');
    assert.ok(!existsSync(join(artifactRoot, 'source-materialization-failed.json')),
        'BINDING_MATERIALIZATION_FAILED');
    regular(join(artifactRoot, 'source-materialization-started.json'));
    const snapshot = json(sourceSnapshot, 'happy-ai-team-source-snapshot-v1');
    if (input.sourceSnapshotSha256) assert.equal(snapshot.sha256, input.sourceSnapshotSha256);
    assert.equal(snapshot.data.sourceRoot, sourceRoot);
    assert.equal(snapshot.data.sourceSha256, sha256(JSON.stringify(snapshot.data.files)));
    assert.equal(sha256(regular(join(artifactRoot, 'source-snapshot.json'))), snapshot.sha256);
    sourceInventory(sourceRoot, snapshot.data.files);
    sourceInventory(artifactRoot, snapshot.data.files);
    const lockSha256 = sha256(regular(join(sourceRoot, 'yarn.lock')));
    assert.equal(sha256(regular(join(artifactRoot, 'yarn.lock'))), lockSha256);
    const metadata = checkMetadata(sourceRoot, artifactRoot, lockSha256, snapshot.data.files);
    if (input.installEvidenceSha256)
        assert.equal(metadata.installSha256, input.installEvidenceSha256);
    if (input.graphReportSha256)
        assert.equal(metadata.graphSha256, input.graphReportSha256);
    const build = json(buildPath, 'happy-ai-team-fresh-consumer-build-v1');
    if (input.freshBuildReportSha256)
        assert.equal(build.sha256, input.freshBuildReportSha256);
    assert.equal(build.data.root, artifactRoot);
    assert.equal(build.data.sourceSha256, snapshot.data.sourceSha256);
    assert.equal(build.data.lockSha256, lockSha256);
    assert.equal(build.data.consumerChecksPassed, true);
    assert.deepEqual(build.data.steps.map((step) => step.step), requiredSteps);
    for (const step of build.data.steps) {
        assert.equal(step.exitCode, 0, `BINDING_BUILD_FAILED: ${step.step}`);
        assert.match(step.log, /^build-[A-Za-z0-9-]+\.log$/);
        assert.equal(sha256(regular(insideFile(artifactRoot, join(artifactRoot, step.log)))),
            step.outputSha256, `BINDING_LOG_MISMATCH: ${step.step}`);
    }
    const web = json(webPath, 'happy-ai-team-fresh-app-web-v1');
    if (input.appWebReportSha256)
        assert.equal(web.sha256, input.appWebReportSha256);
    assert.equal(web.data.root, artifactRoot);
    assert.equal(web.data.sourceSha256, snapshot.data.sourceSha256);
    assert.equal(web.data.exitCode, 0);
    assert.equal(sha256(regular(join(artifactRoot, 'build-app-web-export.log'))),
        web.data.outputSha256);
    const artifacts = artifactInventory(artifactRoot);
    for (const key of ['wireDist', 'cliDist']) {
        assert.equal(build.data.artifacts?.[key]?.sha256, artifacts[key].sha256,
            `BINDING_BUILD_ARTIFACT_${key}`);
        assert.equal(build.data.artifacts[key].files, artifacts[key].files);
    }
    assert.equal(web.data.artifactTreeSha256, artifacts.appWebDist.sha256,
        'BINDING_WEB_ARTIFACT');
    assert.equal(web.data.artifactFiles, artifacts.appWebDist.files);
    sourceInventory(sourceRoot, snapshot.data.files);
    sourceInventory(artifactRoot, snapshot.data.files);
    assert.equal(sha256(JSON.stringify(artifactInventory(artifactRoot))),
        sha256(JSON.stringify(artifacts)), 'BINDING_ARTIFACT_DRIFT');
    for (const [path, expected] of [
        [sourceSnapshot, snapshot.sha256],
        [join(artifactRoot, 'source-snapshot.json'), snapshot.sha256],
        [join(artifactRoot, 'input-inventory.json'), metadata.preparedSha256],
        [join(artifactRoot, 'install-evidence.json'), metadata.installSha256],
        [join(artifactRoot, 'verification-after-patches-root.json'), metadata.graphSha256],
        [buildPath, build.sha256], [webPath, web.sha256],
        ...build.data.steps.map((step) => [join(artifactRoot, step.log), step.outputSha256]),
        [join(artifactRoot, 'build-app-web-export.log'), web.data.outputSha256],
    ]) assert.equal(sha256(regular(path)), expected, `BINDING_REPORT_DRIFT: ${path}`);
    return { format: 'happy-ai-team-fresh-artifact-binding-v1', sourceRoot, artifactRoot,
        contextSha256: input.contextSha256 ?? null,
        sourceSnapshotSha256: snapshot.sha256, sourceSha256: snapshot.data.sourceSha256,
        sourceFiles: snapshot.data.files.length, lockSha256, ...metadata,
        buildReportSha256: build.sha256, appWebReportSha256: web.sha256,
        artifacts, nativeBuildVerified: false, publishedImageVerified: false };
}
