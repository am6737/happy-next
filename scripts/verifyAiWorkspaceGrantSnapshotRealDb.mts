import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';

// Actual owner/admin grant mutations and persisted snapshots over HTTP/DB.
// Authentication and initial Agent are owned fixtures, not browser or runtime.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `grant-snapshot-${randomUUID()}`; const accounts: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 4; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    const [owner, admin, member, outsider] = accounts;
    aiWorkspaceRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = (actor: string, path: string, method = 'GET', body?: unknown) => fetch(`${base}/v1/ai-team${path}`, {
        method, signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': actor,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const workspace = (await (await call(owner, '/workspaces')).json() as any).items.find((item: any) => item.ownerAccountId === owner);
    for (const [account, role] of [[admin, 'admin'], [member, 'member']]) {
        assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${account}`, 'PUT', { role })).status, 200);
    }
    const path = `/workspaces/${workspace.id}/grants?memberAccountId=${member}`;
    assert.equal((await call(member, path)).status, 404);
    assert.equal((await call(outsider, path)).status, 404);
    assert.equal((await call(admin, `/workspaces/${workspace.id}/grants?memberAccountId=${outsider}`)).status, 404);
    assert.equal((await call(admin, `/workspaces/${workspace.id}/grants`)).status, 400);
    const emptyResponse = await call(admin, path); assert.equal(emptyResponse.status, 200);
    const empty = await emptyResponse.json() as any;
    assert.deepEqual(empty.grants, []); assert.equal(empty.memberAccountId, member); assert.equal(empty.role, 'member');
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag,
        role: 'fixture', description: '', emoji: '', instructions: '', settings: { workingDirectory: '/private/owned-fixture' } } });
    const flags = { canView: true, canRun: true, canApprove: false };
    assert.equal((await call(admin, `/workspaces/${workspace.id}/grants`, 'PUT', {
        memberAccountId: member, resourceKind: 'agent', resourceId: agent.id,
        expectedAuthRevision: empty.authRevision, ...flags })).status, 200);
    const staleWrite = await call(admin, `/workspaces/${workspace.id}/grants`, 'PUT', {
        memberAccountId: member, resourceKind: 'agent', resourceId: agent.id,
        expectedAuthRevision: empty.authRevision, canView: true, canRun: false, canApprove: true });
    assert.equal(staleWrite.status, 409, 'Stale grant editor silently replaced the persisted permission snapshot');
    const expected = [{ resourceKind: 'agent', resourceId: agent.id, ...flags }];
    for (const actor of [owner, admin]) {
        const response = await call(actor, path); assert.equal(response.status, 200);
        const snapshot = await response.json() as any;
        assert.deepEqual(snapshot.grants, expected);
        assert.deepEqual(Object.keys(snapshot).sort(), ['authRevision', 'grants', 'memberAccountId', 'role']);
        assert.ok(snapshot.authRevision > empty.authRevision);
        assert.equal(snapshot.authRevision, (await db.aiWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).authRevision);
        assert.ok(!JSON.stringify(snapshot).includes('/private/'));
    }
    // Owner revocation must invalidate subsequent admin reads, including a
    // saved target URL. Existing member grants remain owned by the Workspace.
    assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${admin}`, 'DELETE')).status, 204);
    assert.equal((await call(admin, path)).status, 404);
    assert.equal((await call(owner, path)).status, 200);
    assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'DELETE')).status, 204);
    assert.equal((await call(owner, path)).status, 404);
    console.log('REAL_DB_HTTP_GRANT_SNAPSHOT_OWNER_ADMIN_REVISION_CAS_EXACT_FLAGS_AND_REVOKE_OK');
} finally {
    await app.close();
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_GRANT_SNAPSHOT_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
