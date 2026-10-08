import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.HAPPY_OLD_AGENT_SOURCE;
if (!root) throw new Error('Old source path required');
const stage = (name) => appendFileSync(process.env.HAPPY_OLD_AGENT_STAGE_FILE, `${name}\n`, { mode: 0o600 });
const source = join(root, 'packages/happy-server/sources');
stage('BOOT');
const require = createRequire(join(root, 'packages/happy-server/package.json'));
const imported = async (path) => import(pathToFileURL(join(source, path)).href);
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const app = fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
app.get('/probe-ready', async () => ({ ready: true }));
const { db } = await imported('storage/db.ts');
stage('MODULES');
const { redis } = await imported('storage/redis.ts');
const { auth } = await imported('app/auth/auth.ts');
const { initEncrypt } = await imported('modules/encrypt.ts');
await db.$connect();
stage('DB');
await redis.ping();
stage('REDIS');
await initEncrypt();
await auth.init();
stage('AUTH');
const { enableAuthentication } = await imported('app/api/utils/enableAuthentication.ts');
const { enableErrorHandlers } = await imported('app/api/utils/enableErrorHandlers.ts');
enableErrorHandlers(app);
enableAuthentication(app);
for (const [file, name] of [
  ['app/api/routes/authRoutes.ts', 'authRoutes'],
  ['app/api/routes/connectRoutes.ts', 'connectRoutes'],
  ['app/api/routes/machinesRoutes.ts', 'machinesRoutes'],
  ['app/api/routes/accessKeysRoutes.ts', 'accessKeysRoutes'],
  ['app/api/routes/kvRoutes.ts', 'kvRoutes'],
  ['app/api/routes/orchestratorRoutes.ts', 'orchestratorRoutes'],
  ['app/api/routes/aiTeamRoutes.ts', 'aiTeamRoutes'],
  ['app/api/routes/versionRoutes.ts', 'versionRoutes'],
]) (await imported(file))[name](app);
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT) });
const { startSocket } = await imported('app/api/socket.ts');
startSocket(app);
const { startOrchestratorScheduler } = await imported('app/orchestrator/scheduler.ts');
startOrchestratorScheduler();
stage('ROUTES');
process.once('SIGTERM', () => {
  void app.close().finally(async () => {
    await db.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
});
