import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';

// HTTP and PostgreSQL are real; authentication and initial Agent are owned
// fixtures. No model, App, external notification or template auto-publication.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `template-root-${randomUUID()}`; const accounts: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    const [owner, outsider] = accounts;
    aiTeamRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = (actor: string, path: string, method = 'GET', body?: unknown) => fetch(`${base}/v1/ai-team${path}`, {
        method, signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': actor,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const settings = { instructions: 'Original instructions', engine: 'codex', model: 'original-model',
        workingDirectory: '/private/owned-template-fixture', permissionMode: 'read_only', allowDelegation: false };
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: 'original',
        description: 'Original', emoji: '', instructions: settings.instructions, settings, enabled: false } });
    const content = { role: 'Reviewer', description: 'Owned template description', emoji: '', skills: ['Review'],
        responsibilities: ['Inspect changes'], instructions: 'Owned template instructions' };
    for (const key of ['engine', 'permissionMode', 'allowDelegation', 'enabled', 'workingDirectory', 'settings']) {
        assert.equal((await call(owner, '/agent-templates', 'POST', { name: `${tag}-${key}`, content: {
            ...content, [key]: key === 'allowDelegation' || key === 'enabled' ? true : 'guarded_auto' } })).status, 400);
    }
    const created = await call(owner, '/agent-templates', 'POST', { name: tag, content });
    assert.equal(created.status, 201); const template = await created.json() as any;
    assert.equal(template.contentHash, createHash('sha256').update(JSON.stringify(content)).digest('hex'));
    assert.equal((await call(owner, '/agent-templates', 'POST', { name: tag, content })).status, 409);
    const templatePath = `/agent-templates/${template.id}`;
    const apply = (actor: string, expectedVersion: number) => call(actor, `/agents/${agent.id}/apply-template`, 'POST', {
        templateId: template.id, expectedVersion, confirmed: true });
    assert.equal((await apply(owner, 1)).status, 409);
    for (const suffix of ['', '/versions/1']) assert.equal((await call(outsider, `${templatePath}${suffix}`)).status, 404);
    assert.equal((await apply(outsider, 1)).status, 404);
    assert.equal((await call(owner, `${templatePath}/versions/1/publish`, 'POST', { confirmed: false })).status, 400);
    assert.equal((await call(owner, `${templatePath}/versions/1/publish`, 'POST', { confirmed: true })).status, 200);
    assert.equal((await apply(owner, 1)).status, 200);
    const after = await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id } });
    assert.deepEqual(after.settings, { ...settings, instructions: content.instructions });
    assert.equal(after.enabled, false); assert.equal(after.instructions, content.instructions);
    assert.ok(after.templateVersionId);
    const v1 = await (await call(owner, `${templatePath}/versions/1`)).json() as any;
    const edits = await Promise.all(Array.from({ length: 4 }, (_, i) => call(owner, `${templatePath}/versions`, 'POST', {
        content: { ...content, instructions: `Version draft ${i}` } })));
    assert.ok(edits.every(row => row.status === 201));
    const versions = await Promise.all(edits.map(row => row.json() as Promise<any>));
    assert.deepEqual(versions.map(row => row.version).sort((a, b) => a - b), [2, 3, 4, 5]);
    const unchanged = await (await call(owner, `${templatePath}/versions/1`)).json() as any;
    assert.deepEqual(unchanged, v1, 'Draft edits mutated the published immutable version');
    assert.equal((await call(owner, `${templatePath}/versions/2/publish`, 'POST', { confirmed: true })).status, 409);
    assert.equal((await call(owner, `${templatePath}/rollback`, 'POST', { version: 2, confirmed: true })).status, 409);
    assert.equal((await call(owner, `${templatePath}/versions/5/publish`, 'POST', { confirmed: true })).status, 200);
    assert.equal((await apply(owner, 1)).status, 409);
    assert.equal((await apply(owner, 5)).status, 200);
    assert.equal((await call(owner, `${templatePath}/rollback`, 'POST', { version: 1, confirmed: true })).status, 200);
    assert.equal((await apply(owner, 1)).status, 200);
    const proposalContent = { ...content, instructions: 'Explicitly reviewed proposal instructions' };
    const proposalInput = { clientRequestId: 'owned-proposal', sourceAgentId: agent.id,
        expectedCurrentVersion: 1, content: proposalContent, note: 'Owned proposed improvement' };
    const proposalPath = `${templatePath}/proposals`;
    assert.equal((await call(outsider, proposalPath, 'POST', proposalInput)).status, 404);
    assert.equal((await call(owner, proposalPath, 'POST', { ...proposalInput,
        content: { ...proposalContent, permissionMode: 'guarded_auto' } })).status, 400);
    const proposals = await Promise.all(Array.from({ length: 4 }, () => call(owner, proposalPath, 'POST', proposalInput)));
    assert.deepEqual(proposals.map(row => row.status).sort(), [200, 200, 200, 201]);
    const proposalBodies = await Promise.all(proposals.map(row => row.json() as Promise<any>));
    assert.equal(new Set(proposalBodies.map(row => row.id)).size, 1);
    const proposalId = proposalBodies[0].id;
    assert.equal((await call(owner, proposalPath, 'POST', { ...proposalInput, note: 'Changed note' })).status, 409);
    assert.equal((await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: template.id } })).currentVersion, 1,
        'Proposal automatically published without human review');
    const reject = await call(owner, proposalPath, 'POST', { ...proposalInput,
        clientRequestId: 'owned-reject', content: { ...content, instructions: 'Reject this proposal' } });
    assert.equal(reject.status, 201); const rejectId = (await reject.json() as any).id;
    const review = (actor: string, proposal: string, decision: string, confirmed = true, version = 1) =>
        call(actor, `${proposalPath}/${proposal}/review`, 'POST', { decision, confirmed, expectedCurrentVersion: version });
    assert.equal((await review(owner, rejectId, 'rejected')).status, 200);
    assert.equal((await review(owner, rejectId, 'accepted')).status, 409);
    assert.equal((await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: template.id } })).currentVersion, 1);
    const stale = await call(owner, proposalPath, 'POST', { ...proposalInput,
        clientRequestId: 'owned-stale', content: { ...content, instructions: 'Old base proposal' } });
    assert.equal(stale.status, 201); const staleId = (await stale.json() as any).id;
    assert.equal((await review(outsider, proposalId, 'accepted')).status, 404);
    assert.equal((await review(owner, proposalId, 'accepted', false)).status, 400);
    const accepted = await Promise.all(Array.from({ length: 8 }, () => review(owner, proposalId, 'accepted')));
    assert.ok(accepted.every(row => row.status === 200));
    const acceptedBodies = await Promise.all(accepted.map(row => row.json() as Promise<any>));
    assert.equal(acceptedBodies.filter(row => !row.duplicate).length, 1);
    assert.ok(acceptedBodies.every(row => row.publishedVersion === 6));
    assert.equal(await db.aiAgentTemplateVersion.count({ where: { templateId: template.id } }), 6);
    const publishedProposal = await db.aiAgentTemplateVersion.findUniqueOrThrow({ where: {
        templateId_version: { templateId: template.id, version: 6 } } });
    assert.deepEqual(publishedProposal.content, proposalContent); assert.ok(publishedProposal.publishedAt);
    assert.equal((await review(owner, staleId, 'accepted')).status, 409);
    assert.equal((await db.aiAgentTemplateProposal.findUniqueOrThrow({ where: { id: staleId } })).status, 'pending');
    assert.equal((await call(outsider, proposalPath)).status, 404);
    const proposalList = await (await call(owner, proposalPath)).json() as any;
    assert.equal(proposalList.items.length, 3);
    assert.equal(proposalList.items.find((row: any) => row.id === proposalId).reviewedByAccountId, owner);
    assert.deepEqual(await (await call(owner, `${templatePath}/versions/1`)).json(), { ...v1, current: false },
        'Proposal review changed the old immutable version');
    assert.equal((await apply(owner, 6)).status, 200);
    assert.deepEqual((await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id } })).settings,
        { ...settings, instructions: proposalContent.instructions });
    assert.equal((await call(owner, `${templatePath}/rollback`, 'POST', { version: 1, confirmed: true })).status, 200);
    assert.equal((await apply(owner, 1)).status, 200);
    console.log('REAL_DB_HTTP_TEMPLATE_PROPOSAL_NO_AUTOPUBLISH_REJECT_CONCURRENT_ACCEPT_STALE_AND_RUNTIME_PRESERVATION_OK');
    const source = await (await call(owner, `/agents/${agent.id}/template-source`)).json() as any;
    assert.equal(source.source.version, 1); assert.equal(source.source.current, true);
    assert.equal(source.source.contentHash, template.contentHash);
    assert.equal((await call(owner, `/agents/${agent.id}`, 'DELETE')).status, 204);
    assert.equal((await apply(owner, 1)).status, 404, 'Template application revived an archived Agent');
    const archived = await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id } });
    assert.ok(archived.archivedAt); assert.equal(archived.enabled, false);
    assert.deepEqual(archived.settings, { ...settings, instructions: content.instructions });
    console.log('REAL_DB_HTTP_AGENT_TEMPLATE_IMMUTABLE_VERSIONS_CONFIRM_RUNTIME_PRESERVATION_STALE_AND_ARCHIVE_OK');
} finally {
    await app.close();
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    assert.equal(await db.aiAgentTemplate.count({ where: { accountId: { in: accounts } } }), 0);
    console.log('AI_AGENT_TEMPLATE_ROOT_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
