import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';

// Actual Workspace grant HTTP/DB with a deterministic test-only read barrier.
// The barrier retains the actual query result; it does not forge authorization.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const accounts: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    const id = request.headers['x-fixture-account'];
    if (!accounts.includes(id)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = id;
});
let releaseRead: (() => void) | undefined; let restoreRead: (() => void) | undefined;
let pending: Promise<Response> | undefined;
try {
    for (let i = 0; i < 3; i++) accounts.push((await db.account.create({ data: { publicKey: `workspace-grant-race-${tag}-${i}` } })).id);
    const [owner, admin, member] = accounts;
    aiWorkspaceRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = async (actor: string, path: string, method='GET', body?: unknown) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, { method, signal: AbortSignal.timeout(15000),
            headers: { 'x-fixture-account': actor, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return response;
    };
    const workspaceId = (await (await call(owner, '/workspaces')).json() as any).items.find((x:any)=>x.ownerAccountId===owner).id;
    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${admin}`, 'PUT', { role:'admin' })).status,200);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${member}`, 'PUT', { role:'member' })).status,200);
    const agent = await db.aiAgent.create({ data: { accountId:owner,name:tag,role:'Fixture',description:'',emoji:'',instructions:'',settings:{} } });
    const original = db.aiWorkspaceMembership.findUnique;
    let observed!: () => void; const readObserved = new Promise<void>(resolve=>{observed=resolve});
    const held = new Promise<void>(resolve=>{releaseRead=resolve}); let paused=false;
    (db.aiWorkspaceMembership as any).findUnique = async (args:any) => {
        const actual = await original.call(db.aiWorkspaceMembership,args);
        if (!paused && args?.where?.workspaceId_memberAccountId?.memberAccountId===admin && args.include?.workspace) {
            paused=true; observed(); await held;
        }
        return actual;
    };
    restoreRead=()=>{(db.aiWorkspaceMembership as any).findUnique=original};
    pending=call(admin, `/workspaces/${workspaceId}/grants`, 'PUT', { memberAccountId:member,
        resourceKind:'agent',resourceId:agent.id,canView:true,canRun:true,canApprove:true });
    await Promise.race([readObserved,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Actual authorization barrier not reached')),5000))]);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${admin}`, 'DELETE')).status,204);
    assert.equal(await db.aiWorkspaceMembership.count({where:{workspaceId,memberAccountId:admin}}),0);
    releaseRead(); restoreRead();
    const result=await pending;
    const grants=await db.aiWorkspaceGrant.count({where:{workspaceId,memberAccountId:member,resourceId:agent.id}});
    console.log(JSON.stringify({result:'REAL_DB_HTTP_REVOKED_ADMIN_GRANT_RACE',status:result.status,grants}));
    assert.equal(result.status,404,'Revoked admin mutated resource grants after owner revocation committed');
    assert.equal(grants,0);
    console.log('REAL_DB_HTTP_REVOKED_ADMIN_CANNOT_COMMIT_NEW_RESOURCE_GRANT_OK');
} finally {
    releaseRead?.();restoreRead?.();await pending?.catch(()=>{});await app.close();
    await db.aiWorkspace.deleteMany({where:{ownerAccountId:{in:accounts}}});
    await db.aiAgent.deleteMany({where:{accountId:{in:accounts}}});
    await db.account.deleteMany({where:{id:{in:accounts},publicKey:{startsWith:`workspace-grant-race-${tag}-`}}});
    assert.equal(await db.account.count({where:{id:{in:accounts}}}),0);
    await db.$disconnect();redis.disconnect();
}
