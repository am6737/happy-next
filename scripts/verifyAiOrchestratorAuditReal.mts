import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Packaged, read-only CLI against an owned disk queue with synthetic sensitive
// canaries. No auth, provider, deletion command or external transmission.
const root = await mkdtemp(join(tmpdir(), 'happy-ai-audit-real-'));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canary = `PRIVATE_AUDIT_CANARY_${randomUUID()}`;
const files: Array<{ path: string; text: string }> = [];
const put = async (path: string, text: string) => { await writeFile(path, text, { mode: 0o600 }); files.push({ path, text }); };
try {
    for (const directory of ['approvals', 'capabilities', 'events/unsupported', 'usage/unsupported']) {
        await mkdir(join(root, directory), { recursive: true, mode: 0o700 });
    }
    for (let i = 0; i < 110; i++) {
        await put(join(root, 'approvals', `${i}.json`), JSON.stringify({ executionId: randomUUID(),
            operationId: hash(`operation-${i}`), actionHash: hash(`action-${i}`),
            state: i === 0 ? 'invoking' : 'invoked', acceptedFinish: i !== 0,
            expiresAt: '2000-01-01T00:00:00.000Z', command: canary, token: canary, privatePath: `${root}/${canary}` }));
    }
    await put(join(root, 'approvals', 'invalid.json'), JSON.stringify({ operationId: canary }));
    await put(join(root, 'capabilities', 'owned.json'), JSON.stringify({ executionId: randomUUID(),
        capability: { token: canary, expiresAt: '2000-01-01T00:00:00.000Z' } }));
    await put(join(root, 'events/unsupported', 'owned.json'), JSON.stringify({ summary: canary }));
    await put(join(root, 'events/unsupported', 'owned.json.reason'), 'TELEMETRY_ENDPOINT_UNSUPPORTED\n');
    const output = execFileSync(process.execPath, ['packages/happy-cli/bin/happy.mjs',
        'orchestrator-audit', '--root', root], { encoding: 'utf8', timeout: 30000,
        env: { ...process.env, HAPPY_HOME_DIR: join(root, 'private-cli-home') }, maxBuffer: 2000000 });
    assert.ok(!output.includes(canary), 'Audit leaked sensitive fixture content');
    assert.ok(!output.includes(root), 'Audit leaked the private queue path');
    const audit = JSON.parse(output.trim().split('\n').at(-1)!);
    assert.equal(audit.approvals.total, 111); assert.equal(audit.approvals.invalid, 1);
    assert.equal(audit.approvals.shown, 100); assert.equal(audit.approvals.needsReview, 1);
    assert.equal(audit.approvals.rows[0].state, 'invoking');
    assert.equal(audit.approvals.rows[0].needsReview, true);
    assert.equal(audit.approvals.byState.invoked, 109);
    assert.equal(audit.capabilities.total, 1); assert.equal(audit.capabilities.expired, 1);
    assert.equal(audit.unsupported.rows.length, 1);
    for (const file of files) assert.equal(await readFile(file.path, 'utf8'), file.text, 'Read-only audit mutated a queue record');
    console.log('REAL_PACKAGED_CLI_AUDIT_BOUNDED_ROWS_UNCERTAIN_FIRST_NO_SECRET_NO_MUTATION_OK');
} finally {
    await rm(root, { recursive: true, force: true });
    console.log('AI_ORCHESTRATOR_AUDIT_FIXTURE_CLEANUP residual=0');
}
