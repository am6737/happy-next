import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inventoryTree } from './aiTeamProductionTree.mjs';
import { inventoryProductionSources } from './aiTeamProductionSourceSnapshot.mjs';
import { fileURLToPath } from 'node:url';
import { readArtifactContext, verifyFreshArtifactBinding } from './aiTeamProductionArtifactBinding.mjs';

const [freshArg, snapshotArg] = process.argv.slice(2);
assert.equal(process.argv.length, 4,
    'Usage: node scripts/aiTeamProductionFreshBuild.mjs FRESH_ROOT SOURCE_SNAPSHOT');
const fresh = resolve(freshArg), snapshotPath = resolve(snapshotArg);
assert.match(fresh, /^\/tmp\/ai-team-frozen-deps-[A-Za-z0-9]+$/);
assert.match(snapshotPath, /^\/tmp\/ai-team-source-snapshot-[A-Za-z0-9-]+\.json$/);
const snapshot = JSON.parse(readFileSync(snapshotPath));
const contextPath = `/tmp/ai-team-artifact-context-${basename(fresh)}.json`;
assert.equal(existsSync(contextPath), false, 'Refusing existing artifact context');
assert.equal(snapshot.sourceRoot, resolve(fileURLToPath(new URL('..', import.meta.url))));
assert.ok(lstatSync(fresh).isDirectory() && !lstatSync(fresh).isSymbolicLink());
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = () => {
    for (const root of [snapshot.sourceRoot, fresh])
        assert.equal(sha(JSON.stringify(inventoryProductionSources(root))), snapshot.sourceSha256,
            `Source changed: ${root}`);
};
const exclusive = (name, value) => writeFileSync(join(fresh, name), `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 });
check();
for (const name of ['consumer-build-report-root.json', 'app-web-build-report-root.json',
    'verification-after-patches-root.json', 'final-build-started-root.json'])
    assert.equal(existsSync(join(fresh, name)), false, `Refusing existing report: ${name}`);
const startedAt = new Date().toISOString();
exclusive('final-build-started-root.json', { startedAt, sourceSha256: snapshot.sourceSha256 });
const env = { PATH: process.env.PATH, HOME: join(fresh, '.home'), YARN_CACHE_FOLDER: join(fresh, '.yarn-cache'),
    npm_config_userconfig: '/dev/null', CI: '1', DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build' };
const steps = [];
async function run(step, executable, args, cwd, logName = `build-${step}.log`, extraEnv = {}) {
    const log = join(fresh, logName), fd = openSync(log, 'wx', 0o600), start = Date.now();
    let result;
    try {
        result = await new Promise((done, reject) => {
            const child = spawn(executable, args, { cwd, detached: true,
                env: { ...env, ...extraEnv }, stdio: ['ignore', fd, fd] });
            const deadline = setTimeout(() => {
                try { process.kill(-child.pid, 'SIGKILL'); }
                catch { child.kill('SIGKILL'); }
            }, 900_000);
            child.once('error', error => { clearTimeout(deadline); reject(error); });
            child.once('exit', (exitCode, signal) => { clearTimeout(deadline); done({ exitCode, signal }); });
        });
    } finally { closeSync(fd); }
    const evidence = { step, command: [executable, ...args].join(' '), ...result,
        elapsedMs: Date.now() - start, outputSha256: sha(readFileSync(log)), log: logName };
    console.log(JSON.stringify(evidence));
    assert.equal(result.exitCode, 0, `Build failed: ${step}; see ${log}`);
    return evidence;
}
const definitions = [
    ['root-patches', '', ['run', 'postinstall']],
    ['app-patches-assets', 'happy-app', ['run', 'postinstall']],
    ['cli-tools', 'happy-cli', ['run', 'postinstall']],
    ['wire-build', 'happy-wire', ['build']],
    ['prisma-generate', 'happy-server', ['generate']],
    ['server-typecheck', 'happy-server', ['build']],
    ['cli-normal-build', 'happy-cli', ['build']],
    ['app-typecheck', 'happy-app', ['typecheck']],
    ['voice-typecheck', 'happy-voice', ['typecheck']],
];
try {
    for (const [step, pkg, args] of definitions) {
        check();
        steps.push(await run(step, 'yarn', args, pkg ? join(fresh, 'packages', pkg) : fresh));
    }
    check();
    await run('dependency-graph', process.execPath,
        [join(snapshot.sourceRoot, 'scripts/aiTeamProductionFrozenDeps.mjs'), 'verify', fresh,
            join(fresh, 'verification-after-patches-root.json')], snapshot.sourceRoot);
    const artifacts = Object.fromEntries([['cliDist', 'happy-cli'], ['wireDist', 'happy-wire']].map(([key, pkg]) => {
        const tree = inventoryTree(fresh, join(fresh, 'packages', pkg, 'dist'));
        assert.ok(tree.files.length > 0);
        return [key, { files: tree.files.length, sha256: tree.sha256 }];
    }));
    exclusive('consumer-build-report-root.json', { format: 'happy-ai-team-fresh-consumer-build-v1',
        root: fresh, sourceSha256: snapshot.sourceSha256, lockSha256: sha(readFileSync(join(fresh, 'yarn.lock'))),
        startedAt, completedAt: new Date().toISOString(), steps, artifacts, consumerChecksPassed: true,
        appWebBuildVerified: false, nativeBuildVerified: false, publishedImageVerified: false });
    const web = await run('app-web-export', join(fresh, 'node_modules/.bin/expo'),
        ['export', '--platform', 'web', '--output-dir', 'dist'], join(fresh, 'packages/happy-app'),
        'build-app-web-export.log', { NODE_ENV: 'production', APP_ENV: 'production' });
    check();
    const tree = inventoryTree(fresh, join(fresh, 'packages/happy-app/dist'));
    assert.ok(tree.files.length > 0);
    exclusive('app-web-build-report-root.json', { format: 'happy-ai-team-fresh-app-web-v1', root: fresh,
        command: web.command, exitCode: web.exitCode, elapsedMs: web.elapsedMs,
        outputSha256: web.outputSha256, sourceSha256: snapshot.sourceSha256,
        completedAt: new Date().toISOString(), artifactFiles: tree.files.length, artifactTreeSha256: tree.sha256,
        nativeBuildVerified: false, publishedImageVerified: false });
    const input = { sourceRoot: snapshot.sourceRoot, artifactRoot: fresh, sourceSnapshot: snapshotPath,
        freshBuildReport: join(fresh, 'consumer-build-report-root.json'),
        appWebReport: join(fresh, 'app-web-build-report-root.json') };
    const binding = verifyFreshArtifactBinding(snapshot.sourceRoot, input);
    writeFileSync(contextPath, `${JSON.stringify({ format: 'happy-ai-team-artifact-context-v1', ...input,
        sourceSnapshotSha256: binding.sourceSnapshotSha256,
        freshBuildReportSha256: binding.buildReportSha256, appWebReportSha256: binding.appWebReportSha256,
        installEvidenceSha256: binding.installSha256, graphReportSha256: binding.graphSha256 }, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 });
    verifyFreshArtifactBinding(snapshot.sourceRoot, readArtifactContext(contextPath, snapshot.sourceRoot));
    console.log(JSON.stringify({ completed: true, sourceSha256: snapshot.sourceSha256, artifacts,
        web: { files: tree.files.length, sha256: tree.sha256 }, contextPath, productionReady: false }));
} catch (error) {
    exclusive('final-build-failed-root.json', { sourceSha256: snapshot.sourceSha256,
        failedAt: new Date().toISOString(), completedSteps: steps, error: String(error), productionReady: false });
    throw error;
}
