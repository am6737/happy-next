import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArtifactContext, verifyFreshArtifactBinding } from './aiTeamProductionArtifactBinding.mjs';
import { compatibilityEvidenceExpected, createCompatibilityEvidenceV2 } from './aiTeamProductionCompatibilityEvidence.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const flags = ['--artifact-context', '--case-prefix', '--case-suffix',
    '--server-report', '--image-report', '--write'];
assert.equal(args.length, flags.length * 2,
    'Usage: node scripts/aiTeamProductionCompatibilityProduce.mjs --artifact-context FILE --case-prefix /tmp/PREFIX --case-suffix SUFFIX --server-report FILE --image-report FILE --write NEW_FILE');
assert.ok(args.every((arg, i) => i % 2 || flags.includes(arg)));
assert.ok(flags.every((flag) => args.filter((arg) => arg === flag).length === 1 && option(flag)));
const contextPath = option('--artifact-context');
const prefix = option('--case-prefix');
const suffix = option('--case-suffix');
const output = option('--write');
assert.match(prefix, /^\/tmp\/[A-Za-z0-9_-]+$/);
assert.match(suffix, /^[A-Za-z0-9_-]+$/);
assert.match(output, /^\/tmp\/[A-Za-z0-9_-]+\.json$/);
assert.equal(resolve(output), output);
const context = readArtifactContext(contextPath, root);
const binding = verifyFreshArtifactBinding(root, context);
const result = execFileSync(process.execPath, ['scripts/aiTeamProductionPreflight.mjs',
    '--artifact-context', contextPath], { cwd: root, encoding: 'utf8', maxBuffer: 1_000_000 });
const audit = JSON.parse(result);
assert.equal(audit.artifactContextSha256, binding.contextSha256);
const producer = 'scripts/aiTeamProductionCompatibilityProduce.mjs';
const producerSha256 = createHash('sha256').update(readFileSync(resolve(root, producer))).digest('hex');
const expected = compatibilityEvidenceExpected(audit, binding, context, producerSha256);
const evidence = createCompatibilityEvidenceV2({ casePrefix: prefix, caseSuffix: suffix,
    serverReport: option('--server-report'), imageReport: option('--image-report') }, expected);
const afterBinding = verifyFreshArtifactBinding(root, context);
const afterAudit = JSON.parse(execFileSync(process.execPath, ['scripts/aiTeamProductionPreflight.mjs',
    '--artifact-context', contextPath], { cwd: root, encoding: 'utf8', maxBuffer: 1_000_000 }));
assert.equal(afterBinding.contextSha256, binding.contextSha256);
assert.equal(afterAudit.candidateSha256, audit.candidateSha256);
assert.equal(afterAudit.artifactContextSha256, audit.artifactContextSha256);
const parent = lstatSync(resolve(output, '..'));
assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ result: 'compatibility_evidence_v2_written', path: output,
    candidateSha256: audit.candidateSha256, artifactContextSha256: binding.contextSha256,
    requiredChecks: evidence.requiredChecks, productionReady: false }));
