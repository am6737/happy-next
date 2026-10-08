import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import httpProxy from 'http-proxy';
import nacl from 'tweetnacl';
import { PrismaClient } from '@prisma/client';

let base = process.env.HAPPY_TEST_SERVER_URL ?? 'http://127.0.0.1:3067';
const telemetryKill = process.env.HAPPY_TEST_TELEMETRY_KILL === '1';
const recoveryTwice = process.env.HAPPY_TEST_CAPABILITY_RECOVERY_TWICE === '1';
const offlineFinishProxy = process.env.HAPPY_TEST_OFFLINE_FINISH_PROXY === '1';
const identityCheck = process.env.HAPPY_TEST_IDENTITY === '1';
let telemetryBlocked = telemetryKill;
let finishBlocked = recoveryTwice || offlineFinishProxy;
let telemetryProxy;
if (telemetryKill || recoveryTwice || offlineFinishProxy) {
  const target = base;
  const forward = httpProxy.createProxyServer({ target, ws: true });
  telemetryProxy = createServer((req, res) => {
    if (telemetryBlocked && /^\/v1\/ai-team\/executions\/[^/]+\/(events|usage-deltas)$/.test(req.url?.split('?')[0] ?? '')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"test telemetry outage"}');
      return;
    }
    if (finishBlocked && /^\/v1\/orchestrator\/executions\/[^/]+\/finish$/.test(req.url?.split('?')[0] ?? '')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"test finish outage"}');
      return;
    }
    forward.web(req, res);
  });
  forward.on('error', (_error, _req, res) => {
    if (res && !res.headersSent) res.writeHead(502);
    res?.end();
  });
  telemetryProxy.on('upgrade', (req, socket, head) => forward.ws(req, socket, head));
  await new Promise((resolve) => telemetryProxy.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${telemetryProxy.address().port}`;
}
const offlineFinish = process.env.HAPPY_TEST_OFFLINE_FINISH === '1' || offlineFinishProxy;
const providerTimeout = process.env.HAPPY_TEST_PROVIDER_TIMEOUT === '1';
const providerCancel = process.env.HAPPY_TEST_PROVIDER_CANCEL === '1';
const providerTimeoutMs = Number(process.env.HAPPY_TEST_PROVIDER_TIMEOUT_MS ?? '30000');
if ((providerTimeout || providerCancel) && (!Number.isSafeInteger(providerTimeoutMs)
  || providerTimeoutMs < 10000 || providerTimeoutMs > 120000))
  throw new Error('Provider test timeout must be a safe integer from 10000 to 120000 ms');
const p1 = process.env.HAPPY_TEST_P1 === '1';
const steer = process.env.HAPPY_TEST_STEER === '1';
const steerKill = process.env.HAPPY_TEST_STEER_KILL === '1';
const conflict = process.env.HAPPY_TEST_CONFLICT === '1';
const resume = process.env.HAPPY_TEST_RESUME === '1';
const skill = process.env.HAPPY_TEST_SKILL === '1';
const approvalPublic = process.env.HAPPY_TEST_APPROVAL_PUBLIC === '1';
const approvalPendingKill = approvalPublic && process.env.HAPPY_TEST_APPROVAL_PENDING_KILL === '1';
const approvalProviderCancel = approvalPublic && process.env.HAPPY_TEST_APPROVAL_PROVIDER_CANCEL === '1';
const approvalKill = approvalPublic && process.env.HAPPY_TEST_APPROVAL_KILL === '1';
const capabilityRecovery = approvalPublic && process.env.HAPPY_TEST_CAPABILITY_RECOVERY === '1';
const capabilityRecoveryRevoked = capabilityRecovery && process.env.HAPPY_TEST_CAPABILITY_REVOKED === '1';
const templateProposal = process.env.HAPPY_TEST_TEMPLATE_PROPOSAL === '1';
const templateReject = process.env.HAPPY_TEST_TEMPLATE_REJECT === '1';
const project = process.env.HAPPY_TEST_PROJECT === '1' || approvalPublic || templateProposal;
const legacySession = process.env.HAPPY_TEST_LEGACY_SESSION === '1';
const projectMcp = process.env.HAPPY_TEST_PROJECT_MCP === '1';
const approval = process.env.HAPPY_TEST_APPROVAL === '1';
const approvalProviderTimeout = approval && process.env.HAPPY_TEST_APPROVAL_PROVIDER_TIMEOUT === '1';
const approvalReject = (approval || approvalPublic) && process.env.HAPPY_TEST_APPROVAL_REJECT === '1';
const claudeProvider = process.env.HAPPY_TEST_PROVIDER === 'claude';
const root = mkdtempSync(join(tmpdir(), 'happy-p0-cli-real-'));
const home = join(root, 'happy-home');
const codexHome = join(root, 'codex-home');
const repo = join(root, 'repo');
chmodSync(root, 0o700);
mkdirSync(home, { mode: 0o700 }); mkdirSync(codexHome, { mode: 0o700 }); mkdirSync(repo, { mode: 0o700 });
process.on('exit', () => {
  rmSync(join(home, 'access.key'), { force: true });
  rmSync(join(codexHome, 'auth.json'), { force: true });
  rmSync(join(codexHome, 'config.toml'), { force: true });
});
if (!claudeProvider) {
  copyFileSync(join(homedir(), '.codex', 'auth.json'), join(codexHome, 'auth.json'));
  copyFileSync(join(homedir(), '.codex', 'config.toml'), join(codexHome, 'config.toml'));
  chmodSync(join(codexHome, 'auth.json'), 0o600);
  chmodSync(join(codexHome, 'config.toml'), 0o600);
}
const keypair = nacl.sign.keyPair();
const challenge = nacl.randomBytes(32);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const authResponse = await fetch(`${base}/v1/auth`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ publicKey: b64(keypair.publicKey), challenge: b64(challenge), signature: b64(nacl.sign.detached(challenge, keypair.secretKey)) }),
});
if (!authResponse.ok) throw new Error(`Test account authentication failed: HTTP ${authResponse.status}`);
const { token } = await authResponse.json();
let recoveryHuman;
if (capabilityRecovery) {
  if (!process.env.HAPPY_TEST_HUMAN_OPERATOR_KEY_FILE)
    throw new Error('Owned recovery operator key is required');
  const { createOwnedRecoveryHuman } = await import('./ai-team-owned-recovery-human.mjs');
  recoveryHuman = await createOwnedRecoveryHuman({
    base: process.env.HAPPY_TEST_SERVER_URL ?? base,
    accountId: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub,
    token, keyFile: process.env.HAPPY_TEST_HUMAN_OPERATOR_KEY_FILE,
  });
}
writeFileSync(join(home, 'access.key'), JSON.stringify({ encryption: { publicKey: b64(keypair.publicKey), machineKey: b64(nacl.randomBytes(32)) }, token }), { mode: 0o600 });
const env = { ...process.env, HAPPY_HOME_DIR: home, CODEX_HOME: codexHome, HAPPY_SERVER_URL: base, HAPPY_DISABLE_CAFFEINATE: 'true' };
if (claudeProvider) {
  const pid = Number(process.env.HAPPY_TEST_PROVIDER_ENV_PID);
  if (!Number.isSafeInteger(pid) || pid < 1 || (await import('node:fs')).statSync(`/proc/${pid}`).uid !== process.getuid())
    throw new Error('Owned Claude provider environment PID required');
  const allowed = new Set(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']);
  for (const entry of readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0 && allowed.has(entry.slice(0, separator))) env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  if (!env.ANTHROPIC_AUTH_TOKEN || !env.ANTHROPIC_BASE_URL)
    throw new Error('Owned Claude provider references unavailable');
}
const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git(['init']); git(['config', 'user.name', 'P0 Test']); git(['config', 'user.email', 'p0-test@example.invalid']);
writeFileSync(join(repo, 'README.md'), 'P0 test repository\n'); git(['add', '.']); git(['commit', '-m', 'initial']);
if (projectMcp) {
  mkdirSync(join(repo, '.codex'), { mode: 0o700 });
  const marker = join(root, 'unauthorized-mcp-probe');
  writeFileSync(join(repo, '.codex', 'config.toml'),
    `[mcp_servers.project_probe]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["-e", ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called')`)}]\n`);
  git(['add', '.codex/config.toml']); git(['commit', '-m', 'fake project MCP probe']);
}
if (conflict) {
  writeFileSync(join(repo, 'shared.txt'), 'base\n'); git(['add', '.']); git(['commit', '-m', 'shared base']);
}
const cli = process.env.HAPPY_TEST_CLI_ENTRY ?? resolve('bin/happy.mjs');
const startDaemon = () => spawn(process.execPath, [cli, 'daemon', 'start-sync'], { env, cwd: process.cwd(),
  detached: approvalPendingKill, stdio: ['ignore', 'pipe', 'pipe'] });
let daemon = startDaemon();
let daemonOutput = '';
daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
const request = async (path, body, method = 'POST') => {
  const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(value)}`);
  return value;
};
try {
  for (let i = 0; i < 60 && !existsSync(join(home, 'daemon.state.json')); i++) await delay(500);
  if (!existsSync(join(home, 'daemon.state.json'))) throw new Error('Isolated daemon did not start');
  let readyMachine;
  for (let i = 0; i < 60; i++) {
    const context = await request('/v1/orchestrator/context', undefined, 'GET');
    readyMachine = context.data?.machines?.find((machine) => machine.dispatchReady && machine.providers?.includes(claudeProvider ? 'claude' : 'codex'));
    if (readyMachine) break;
    await delay(500);
  }
  if (!readyMachine) throw new Error('Isolated daemon did not register a Codex dispatch RPC');
  if (p1) {
    const db = new PrismaClient();
    const accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    const tag = randomUUID();
    const settings = { instructions: '', engine: 'codex', model: 'default', workingDirectory: repo,
      permissionMode: 'guarded_auto', allowDelegation: false };
    const agents = [];
    for (const name of ['leader', 'alpha', 'beta']) agents.push(await db.aiAgent.create({ data: {
      accountId, name: `${name}-${tag}`, role: 'Test', description: '', emoji: '', instructions: '',
      settings: { ...settings, allowDelegation: name === 'leader' },
    } }));
    let publishedSkill;
    let skillBytes;
    if (skill) {
      skillBytes = Buffer.from('# Exact file review\nConfirm the requested output file bytes with a failing comparison command.\n');
      const created = await request('/v1/ai-team/skills', { name: `test-skill-${tag}` });
      const version = await request(`/v1/ai-team/skills/${created.id}/versions`, {
        files: [{ path: 'SKILL.md', contentBase64: skillBytes.toString('base64') }],
      });
      await request(`/v1/ai-team/skills/${created.id}/versions/${version.version}/publish`, { confirmed: true });
      await request(`/v1/ai-team/skills/${created.id}/bindings`, { agentId: agents[1].id });
      publishedSkill = { skillId: created.id, version: version.version, hash: version.contentHash };
    }
    const team = await db.aiTeam.create({ data: { accountId, name: tag, description: '', emoji: '', instructions: '',
      leaderId: agents[0].id, members: { create: agents.map((agent) => ({ agentId: agent.id })) } } });
    const conversation = await db.aiConversation.create({ data: { accountId, scopeKey: tag, kind: 'group',
      agentId: agents[0].id, teamId: team.id, title: 'P1 runtime test' } });
    const alpha = `ALPHA_${tag}\n`; const beta = `BETA_${tag}\n`;
    const alphaFile = conflict ? 'shared.txt' : 'alpha.txt';
    const betaFile = conflict ? 'shared.txt' : 'beta.txt';
    const leaderPrompt = `You are the team leader. Call the ai_team_delegate MCP tool exactly twice, once per enabled member, before replying.\n` +
      `First call: delegationKey=alpha, assignedAgentId=${agents[1].id}, title=Alpha, requirements=${steer ? 'First run the shell command sleep 25. Then ' : ''}Write ${alphaFile} with exactly ${JSON.stringify(alpha)} and verify exact bytes using a command that exits nonzero on mismatch. Do not create PRs.\n` +
      `Second call: delegationKey=beta, assignedAgentId=${agents[2].id}, title=Beta, requirements=Write ${betaFile} with exactly ${JSON.stringify(beta)} and verify exact bytes using a command that exits nonzero on mismatch. Do not create PRs.\n` +
      `Use dependsOnTaskIds=[] for both. Include the two returned task IDs in your final reply.`;
    const runRecord = await db.orchestratorRun.create({ data: {
      accountId, title: 'P1 two-member runtime integration', status: 'running', maxConcurrency: 2,
      metadata: { aiTeamId: team.id }, tasks: { create: [
        { seq: 1, taskKey: 'primary', title: 'Delegate', provider: 'codex', prompt: leaderPrompt,
          workingDirectory: repo, permissionMode: 'guarded_auto', targetMachineId: readyMachine.machineId,
          assignedAgentId: agents[0].id, collaborationRole: 'leader_plan', delegationDepth: 0,
          timeoutMs: 300000, status: 'queued' },
        { seq: 2, taskKey: 'aggregate', title: 'Integrate', provider: 'codex',
          prompt: 'Review both integrated member files. Do not change their bytes. Report completion without creating a PR.',
          workingDirectory: repo, permissionMode: 'guarded_auto', targetMachineId: readyMachine.machineId,
          assignedAgentId: agents[0].id, collaborationRole: 'aggregate', dependsOnTaskKeys: ['primary'],
          timeoutMs: 300000, status: 'queued' },
      ] } }, include: { tasks: true } });
    const workItem = await db.aiWorkItem.create({ data: { accountId, assigneeId: agents[0].id, teamId: team.id,
      conversationId: conversation.id, orchestratorRunId: runRecord.id,
      orchestratorTaskId: runRecord.tasks.find((item) => item.taskKey === 'aggregate').id,
      title: 'P1 runtime test', summary: '', sourceType: 'execution', sourceLabel: 'CLI owned test', sourceResourceId: conversation.id } });
    let steeringId;
    if (steer || steerKill) {
      let alphaTask;
      for (let i = 0; i < 120; i++) {
        alphaTask = await db.orchestratorTask.findFirst({ where: { runId: runRecord.id, delegationKey: 'alpha', status: 'running' } });
        if (alphaTask) break;
        await delay(500);
      }
      if (!alphaTask) throw new Error('Alpha was not running for steering');
      const response = await request(`/v1/ai-team/conversations/${conversation.id}/messages`, {
        clientMessageId: randomUUID(), mode: 'steer', targetWorkItemId: workItem.id,
        targetTaskId: alphaTask.id, text: `Continue this same task; write ${alphaFile} with exactly ${JSON.stringify(alpha)} and verify exact bytes.`,
      });
      steeringId = response.steeringId;
      if (!steeringId) throw new Error('Steering was not queued');
    }
    if (steerKill) {
      let delivered = false;
      for (let i = 0; i < 120; i++) {
        const row = await db.aiSteeringMessage.findUnique({ where: { id: steeringId } });
        if (row?.status === 'delivered') { delivered = true; break; }
        await delay(250);
      }
      if (!delivered) throw new Error('Steering was not ACKed after model resume spawn');
      const daemonPid = JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')).pid;
      process.kill(daemonPid, 'SIGKILL');
      daemon = startDaemon();
      daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
      daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
      let recovered;
      for (let i = 0; i < 120; i++) {
        recovered = await db.orchestratorExecution.findFirst({ where: { runId: runRecord.id,
          task: { delegationKey: 'alpha' } }, orderBy: { attempt: 'desc' } });
        if (recovered?.status === 'failed') break;
        await delay(500);
      }
      if (recovered?.status !== 'failed' || recovered.errorCode !== 'STEERING_RECOVERY_REQUIRED')
        throw new Error(`Crash recovery did not block the ACKed steering: ${recovered?.status}/${recovered?.errorCode}`);
      if ((await db.orchestratorRun.findUnique({ where: { id: runRecord.id } }))?.status === 'completed')
        throw new Error('Run completed after interrupted steering');
      console.log(JSON.stringify({ result: 'P1_STEERING_SIGKILL_RECOVERY_PASS', runId: runRecord.id,
        steeringId, errorCode: recovered.errorCode }));
    } else {
    let run;
    for (let i = 0; i < 360; i++) {
      await delay(1000);
      run = (await request(`/v1/orchestrator/runs/${runRecord.id}`, undefined, 'GET')).data;
      if (['completed', 'failed', 'cancelled', 'timeout'].includes(run.status)) break;
    }
    const tasks = await db.orchestratorTask.findMany({ where: { runId: runRecord.id } });
    if (steeringId) {
      const steering = await db.aiSteeringMessage.findUnique({ where: { id: steeringId } });
      if (steering?.status !== 'delivered') throw new Error(`Steering was not delivered: ${steering?.status}`);
    }
    if (tasks.filter((task) => task.collaborationRole === 'delegated').length !== 2)
      throw new Error('Leader did not create two real member tasks');
    if (conflict) {
      const members = tasks.filter((task) => task.collaborationRole === 'delegated');
      const aggregate = tasks.find((task) => task.collaborationRole === 'aggregate');
      if (run?.status !== 'failed' || members.some((task) => task.status !== 'completed')
        || aggregate?.status !== 'failed' || !aggregate.errorMessage?.includes('Integration conflict'))
        throw new Error(`Conflict was not blocked: ${JSON.stringify(tasks.map((task) => ({ role: task.collaborationRole, status: task.status, errorCode: task.errorCode })))}`);
      const aggregateRecord = readdirSync(join(home, 'orchestrator-workspaces')).filter((entry) => entry.endsWith('.json'))
        .map((entry) => JSON.parse(readFileSync(join(home, 'orchestrator-workspaces', entry), 'utf8')))
        .find((item) => item.taskId === aggregate.id);
      if (!aggregateRecord || !existsSync(aggregateRecord.worktreePath)
        || !git(['-C', aggregateRecord.worktreePath, 'status', '--porcelain']).toString().trim())
        throw new Error('Conflict worktree was not preserved for inspection');
      console.log(JSON.stringify({ result: 'P1_CONFLICT_REAL_PASS', runId: runRecord.id,
        memberTaskIds: members.map((item) => item.id), aggregateTaskId: aggregate.id }));
    } else {
    if (run?.status !== 'completed' || tasks.some((task) => task.status !== 'completed'))
      throw new Error(`P1 run did not complete with two members: ${JSON.stringify(tasks.map((task) => ({ role: task.collaborationRole, status: task.status, errorCode: task.errorCode })))}`);
    const aggregateTask = tasks.find((task) => task.collaborationRole === 'aggregate');
    const integrationVerification = await db.aiIntegrationVerification.findFirst({ where: { taskId: aggregateTask?.id } });
    if (integrationVerification?.status !== 'verified' || !integrationVerification.verifiedAt)
      throw new Error(`Aggregate lacks durable server Git verification: ${integrationVerification?.status}`);
    const records = readdirSync(join(home, 'orchestrator-workspaces')).filter((entry) => entry.startsWith('task-') && entry.endsWith('.json'))
      .map((entry) => JSON.parse(readFileSync(join(home, 'orchestrator-workspaces', entry), 'utf8')));
    const workspace = (task) => records.find((item) => item.taskId === task.id);
    const members = tasks.filter((task) => task.collaborationRole === 'delegated');
    const aggregate = tasks.find((task) => task.collaborationRole === 'aggregate');
    if (publishedSkill) {
      const alphaTask = members.find((task) => task.delegationKey === 'alpha');
      const alphaExecution = await db.orchestratorExecution.findFirst({ where: { taskId: alphaTask?.id }, orderBy: { attempt: 'desc' } });
      const queue = join(home, 'orchestrator-finish-queue');
      const scoped = readdirSync(queue).flatMap((entry) => {
        const skillsRoot = join(queue, entry, 'skills');
        return existsSync(skillsRoot) ? readdirSync(skillsRoot).map((name) => join(skillsRoot, name)) : [];
      }).find((path) => existsSync(join(path, 'usage.json'))
        && JSON.parse(readFileSync(join(path, 'usage.json'), 'utf8')).executionId === alphaExecution?.id);
      if (!scoped) throw new Error('Published skill was not installed for the authorized member execution');
      const usage = JSON.parse(readFileSync(join(scoped, 'usage.json'), 'utf8'));
      if (usage.executionId !== alphaExecution.id || usage.taskId !== alphaTask.id
        || JSON.stringify(usage.skills) !== JSON.stringify([publishedSkill])) throw new Error('Skill usage identity mismatch');
      const installed = join(scoped, `${publishedSkill.skillId}-${publishedSkill.version}-${publishedSkill.hash}`, 'SKILL.md');
      if (!readFileSync(installed).equals(skillBytes)) throw new Error('Installed skill bytes differ from published version');
      const betaTask = members.find((task) => task.delegationKey === 'beta');
      if ((await db.aiTaskSkillSnapshot.count({ where: { taskId: betaTask?.id } })) !== 0)
        throw new Error('Skill leaked into an unauthorized member task');
    }
    for (const [index, member] of members.entries()) {
      const file = member.delegationKey === 'alpha' ? 'alpha.txt' : 'beta.txt';
      const expected = member.delegationKey === 'alpha' ? alpha : beta;
      writeFileSync(join(root, `expected-${index}`), expected);
      if (!readFileSync(join(workspace(member).worktreePath, file)).equals(Buffer.from(expected))) throw new Error('Member bytes differ');
    }
    const manifest = { sourceRepository: repo, baseCommit: workspace(aggregate).baseCommit,
      children: members.map((member, index) => ({ taskId: member.id, worktreePath: workspace(member).worktreePath,
        branchName: workspace(member).branchName, commitSha: member.commitSha,
        files: [{ repositoryPath: member.delegationKey === 'alpha' ? 'alpha.txt' : 'beta.txt', expectedLocalPath: join(root, `expected-${index}`) }] })),
      integration: { worktreePath: workspace(aggregate).worktreePath, branchName: workspace(aggregate).branchName,
        commitSha: aggregate.commitSha } };
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    execFileSync(process.execPath, [resolve('../../scripts/verifyAiTeamIntegration.mjs'), join(root, 'manifest.json')], { stdio: 'pipe' });
    await request(`/v1/ai-team/conversations/${conversation.id}/messages`, {
      clientMessageId: randomUUID(), text: 'Could we discuss this further?',
    });
    const daemonLogs = join(home, 'logs');
    const rpcSeen = () => readdirSync(daemonLogs).filter((file) => file.endsWith('-daemon.log'))
      .some((file) => readFileSync(join(daemonLogs, file), 'utf8').includes(':ai-structured-model'));
    for (let i = 0; i < 20 && !rpcSeen(); i++) await delay(500);
    if (!rpcSeen()) throw new Error('Server modelGateway did not invoke the account-scoped machine RPC');
    if (steer) {
      const spawns = readdirSync(daemonLogs).filter((file) => file.endsWith('-daemon.log'))
        .flatMap((file) => readFileSync(join(daemonLogs, file), 'utf8').match(/Spawning: happy orchestrator-oneshot/g) ?? []);
      if (spawns.length < 5) throw new Error('Steering was marked delivered without a resumed model subprocess');
    }
    console.log(JSON.stringify({ result: 'P1_TWO_MEMBER_REAL_PASS', runId: runRecord.id, memberTaskIds: members.map((item) => item.id),
      aggregateTaskId: aggregate.id, aggregateCommit: aggregate.commitSha, structuredModelRpc: true,
      steeringDelivered: !!steeringId, skillInjected: !!publishedSkill }));
    }
    }
    await db.$disconnect();
  } else {
  const exact = `P0_REAL_DAEMON_${Date.now()}\n`;
  let runId;
  let lifecycleObservation;
  let projectId;
  let templateId;
  if (project) {
    const registeredRepoId = randomUUID();
    const branch = git(['branch', '--show-current']).toString().trim();
    const key = `repos:${readyMachine.machineId}`;
    const kv = await request('/v1/kv', { mutations: [{ key, version: -1,
      value: Buffer.from(JSON.stringify([{ id: registeredRepoId, path: repo, displayName: 'CLI P2 isolated' }])).toString('base64') }] });
    if (kv.success !== true) throw new Error('Registered repository KV write failed');
    const created = await request('/v1/ai-team/projects', { kind: 'local', name: 'CLI P2 runtime',
      clientRequestId: randomUUID(), machineId: readyMachine.machineId, registeredRepoId,
      registeredKvVersion: kv.results[0].version, workingDirectory: repo, defaultBranch: branch });
    projectId = created.id;
    const db = new PrismaClient();
    const accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    const agent = await db.aiAgent.create({ data: { accountId, name: `cli-p2-${randomUUID()}`, role: 'Engineer',
      description: '', emoji: '', instructions: '', settings: { engine: claudeProvider ? 'claude' : 'codex', model: 'default',
        instructions: '', workingDirectory: repo, permissionMode: approvalPublic ? 'approval' : templateProposal ? 'read_only' : 'guarded_auto', allowDelegation: false } } });
    if (templateProposal) {
      const original = { role: 'Engineer', description: 'Test project work', emoji: '', skills: [],
        responsibilities: ['Check exact file bytes'], instructions: 'Keep the task output exact.' };
      const createdTemplate = await request('/v1/ai-team/agent-templates', {
        name: `cli-template-${randomUUID()}`, content: original });
      templateId = createdTemplate.id;
      await request(`/v1/ai-team/agent-templates/${templateId}/versions/1/publish`, { confirmed: true });
      const frozen = await db.aiAgentTemplateVersion.findUniqueOrThrow({ where: {
        templateId_version: { templateId, version: 1 } } });
      await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: frozen.id } });
      const workspaces = await request('/v1/ai-team/workspaces', undefined, 'GET');
      const workspace = workspaces.items?.find((item) => item.role === 'owner');
      if (!workspace) throw new Error('Test account has no owner workspace');
      const createdRun = await request(`/v1/ai-team/workspaces/${workspace.id}/projects/${projectId}/run`, {
        clientRequestId: randomUUID(), agentId: agent.id, title: 'Execution template proposal test',
        summary: 'Call the MCP tool mcp__happy_template__ai_template_propose directly exactly once. Use a unique clientRequestId, copy the bound template six content fields and change instructions to mention exact byte verification. Set note to explain the improvement. Do not use shell commands, edit files, publish, review, or ask for user input.',
      });
      runId = createdRun.runId;
      if (!runId) throw new Error('Public Project template run did not return a run ID');
    } else if (approvalPublic) {
      const workspaces = await request('/v1/ai-team/workspaces', undefined, 'GET');
      const workspace = workspaces.items?.find((item) => item.role === 'owner');
      if (!workspace) throw new Error('Test account has no owner workspace');
      const createdRun = await request(`/v1/ai-team/workspaces/${workspace.id}/projects/${projectId}/run`, {
        clientRequestId: randomUUID(), agentId: agent.id, title: 'Approval public Project run',
        summary: approvalKill
          ? `Your first shell command must sleep 20 seconds and then create exact.txt with exactly ${JSON.stringify(exact)}. Request explicit approval for this one command. Do not use apply_patch or workspace-write. Do not create a PR.`
          : `Use a shell command requiring explicit approval to create exact.txt with exactly these bytes: ${JSON.stringify(exact)}. Do not use apply_patch or workspace-write. After approval, verify the exact bytes. Do not create a PR.`,
      });
      runId = createdRun.runId;
      if (!runId) throw new Error('Public Project approval run did not return a run ID');
      if (approvalProviderCancel) {
        const { observeProvider, assertObservedProcessesExited } = await import('./ai-team-provider-process.mjs');
        const observed = await observeProvider(db, runId, 'codex-app-server');
        let decision;
        for (let attempt = 0; attempt < 240; attempt++) {
          decision = await db.aiDecisionRequest.findFirst({ where: { runId, status: 'pending' } });
          if (decision) break;
          await delay(250);
        }
        if (!decision || decision.executionId !== observed.executionId)
          throw new Error('Actual SDK approval did not pause the observed execution');
        await request(`/v1/orchestrator/runs/${runId}/cancel`, { reason: 'isolated-sdk-cancel-test' });
        let terminal;
        for (let attempt = 0; attempt < 240; attempt++) {
          terminal = await db.orchestratorExecution.findUnique({ where: { id: observed.executionId } });
          if (terminal && ['cancelled', 'failed', 'timeout', 'completed'].includes(terminal.status)) break;
          await delay(250);
        }
        await assertObservedProcessesExited(observed);
        const attempts = await db.orchestratorExecution.count({ where: { taskId: terminal?.taskId } });
        if (terminal?.status !== 'cancelled' || attempts !== 1
          || existsSync(join(observed.worktreePath, 'exact.txt')))
          throw new Error('SDK cancellation did not preserve the original execution boundary');
        console.log(JSON.stringify({ result: 'ACTUAL_APPROVAL_SDK_CANCEL_VERIFIED',
          executionId: observed.executionId, attempts, providerProcessExited: true }));
        throw new Error('APPROVAL_SDK_CANCEL_VERIFIED');
      }
      if (approvalPendingKill) {
        let decision;
        for (let i = 0; i < 240; i++) {
          decision = await db.aiDecisionRequest.findFirst({ where: { runId, status: 'pending' } });
          if (decision) break;
          await delay(500);
        }
        if (!decision) throw new Error('Actual approval request was not pending before kill');
        const execution = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: decision.executionId } });
        if (execution.status !== 'running' || !execution.childSessionId || !execution.worktreePath
          || existsSync(join(execution.worktreePath, 'exact.txt')))
          throw new Error('Original execution was not safely paused');
        const queueBase = join(home, 'orchestrator-finish-queue');
        const scope = readdirSync(queueBase).find((entry) => existsSync(join(queueBase, entry,
          'approvals', `${createHash('sha256').update(`${execution.id}\0${decision.operationId}`).digest('hex')}.json`)));
        if (!scope) throw new Error('Requested operation journal missing before kill');
        const journal = join(queueBase, scope, 'approvals',
          `${createHash('sha256').update(`${execution.id}\0${decision.operationId}`).digest('hex')}.json`);
        if (JSON.parse(readFileSync(journal, 'utf8')).state !== 'requested')
          throw new Error('Pending operation changed state before kill');
        process.kill(-daemon.pid, 'SIGKILL');
        await delay(500);
        daemon = startDaemon();
        daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
        daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
        let terminal;
        for (let i = 0; i < 120; i++) {
          terminal = await db.orchestratorExecution.findUnique({ where: { id: execution.id } });
          if (terminal?.status === 'failed') break;
          await delay(500);
        }
        const attempts = await db.orchestratorExecution.count({ where: { taskId: execution.taskId } });
        if (terminal?.status !== 'failed' || terminal.errorCode !== 'APPROVAL_SESSION_INTERRUPTED'
          || attempts !== 1 || existsSync(join(execution.worktreePath, 'exact.txt'))
          || JSON.parse(readFileSync(journal, 'utf8')).state !== 'requested')
          throw new Error('Interrupted approval did not fail closed on its original execution');
        const late = await fetch(`${base}/v1/ai-team/decisions/${decision.id}/respond`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ version: decision.version, clientRequestId: randomUUID(), decision: 'approved' }) });
        if (late.status !== 409) throw new Error('Terminal interrupted approval accepted late authorization');
        console.log(JSON.stringify({ result: 'ACTUAL_PENDING_APPROVAL_KILL_RECOVERED_AS_FAILED',
          executionId: execution.id, attempts, lateApproval: late.status,
          errorCode: terminal.errorCode }));
        throw new Error('APPROVAL_PENDING_KILL_VERIFIED');
      }
      if (capabilityRecovery) {
        const { observeProvider, assertObservedProcessesExited } = await import('./ai-team-provider-process.mjs');
        const sdkProcess = await observeProvider(db, runId, 'codex-app-server');
        let decision;
        for (let i = 0; i < 240; i++) {
          decision = await db.aiDecisionRequest.findFirst({ where: { runId, status: 'pending' } });
          if (decision) break;
          await delay(500);
        }
        if (!decision) throw new Error('Recovery fixture did not reach actual Codex approval pause');
        const execution = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: decision.executionId } });
        if (execution.status !== 'running' || !execution.childSessionId || !execution.worktreePath
          || !execution.branchName || existsSync(join(execution.worktreePath, 'exact.txt')))
          throw new Error('Recovery fixture lacked bound active execution identity');
        const queueBase = join(home, 'orchestrator-finish-queue');
        const scope = readdirSync(queueBase).find((entry) => existsSync(join(queueBase, entry,
          'capabilities', `${createHash('sha256').update(execution.id).digest('hex')}.json`)));
        if (!scope) throw new Error('Execution capability was not persisted');
        const capabilityFile = join(queueBase, scope, 'capabilities',
          `${createHash('sha256').update(execution.id).digest('hex')}.json`);
        const capability = JSON.parse(readFileSync(capabilityFile, 'utf8'));
        if (capability.executionId !== execution.id || capability.dispatchToken !== execution.dispatchToken)
          throw new Error('Local capability differs from actual execution');
        const expiredAt = new Date(Date.now() - 2_000);
        const expired = await db.aiExecutionCapability.updateMany({ where: { executionId: execution.id,
          tokenHash: createHash('sha256').update(capability.capability.token).digest('hex') },
          data: { expiresAt: expiredAt } });
        if (expired.count !== 1) throw new Error('Expected one owned capability to expire');
        const oldRenew = await fetch(`${base}/v1/ai-team/executions/${execution.id}/capabilities/renew`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ machineId: readyMachine.machineId,
            dispatchToken: execution.dispatchToken, capability: capability.capability.token }) });
        if (oldRenew.status !== 409) throw new Error('Expired standard capability renewed');
        const wrongMachine = await fetch(`${base}/v1/ai-team/executions/${execution.id}/capabilities/recovery-requests`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ machineId: randomUUID(), dispatchToken: execution.dispatchToken,
            expiredCapability: capability.capability.token }) });
        if (wrongMachine.status !== 409) throw new Error('Wrong machine recovery request was accepted');
        const temporary = `${capabilityFile}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify({ ...capability,
          capability: { ...capability.capability, expiresAt: expiredAt.toISOString() } }), { mode: 0o600 });
        renameSync(temporary, capabilityFile);
        let recovery;
        for (let i = 0; i < 120; i++) {
          recovery = await db.aiCapabilityRecoveryRequest.findUnique({ where: { executionId: execution.id } });
          if (recovery) break;
          await delay(500);
        }
        if (!recovery || recovery.status !== 'pending') throw new Error('Expired capability did not request owner confirmation');
        const before = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
        if (before.status !== 'running') throw new Error('Execution finished before recovery confirmation');
        if (capabilityRecoveryRevoked) {
          const revoked = await db.aiExecutionCapability.updateMany({ where: { executionId: execution.id,
            tokenHash: createHash('sha256').update(capability.capability.token).digest('hex') },
            data: { revokedAt: new Date() } });
          if (revoked.count !== 1) throw new Error('Expected one owned capability to revoke');
          const denied = await fetch(`${base}/v1/ai-team/capability-recoveries/${recovery.id}/confirm`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ confirmation: 'drain_failed_execution' }) });
          if (denied.status !== 409) throw new Error('Revoked capability recovery was confirmed');
          if ((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).status !== 'running')
            throw new Error('Revoked recovery changed execution status');
          console.log(JSON.stringify({ result: 'REAL_REVOKED_CAPABILITY_DRAIN_REJECTED',
            executionId: execution.id, confirmation: denied.status }));
          throw new Error('CAPABILITY_REVOKED_VERIFIED');
        }
        const firstConfirmation = await recoveryHuman.assertion(recovery.id, 1);
        await request(`/v1/ai-team/capability-recoveries/${recovery.id}/confirm`, firstConfirmation);
        if (recoveryTwice) {
          let firstDrain;
          for (let i = 0; i < 120; i++) {
            firstDrain = JSON.parse(readFileSync(capabilityFile, 'utf8'));
            if (firstDrain.capability.recoveryMode === 'drain') break;
            await delay(500);
          }
          if (firstDrain?.recoveryGeneration !== 1 || firstDrain.recoveryId !== recovery.id
            || firstDrain.originalCapability?.token !== capability.capability.token)
            throw new Error('First drain did not retain original private proof');
          const firstHash = createHash('sha256').update(firstDrain.capability.token).digest('hex');
          const expiredDrain = new Date(Date.now() - 2_000);
          const changed = await db.aiExecutionCapability.updateMany({ where: {
            executionId: execution.id, tokenHash: firstHash }, data: { expiresAt: expiredDrain } });
          if (changed.count !== 1) throw new Error('Expected one owned drain capability to expire');
          const tempDrain = `${capabilityFile}.${randomUUID()}.tmp`;
          writeFileSync(tempDrain, JSON.stringify({ ...firstDrain,
            capability: { ...firstDrain.capability, expiresAt: expiredDrain.toISOString() } }), { mode: 0o600 });
          renameSync(tempDrain, capabilityFile);
          let second;
          for (let i = 0; i < 120; i++) {
            second = await db.aiCapabilityRecoveryRequest.findUnique({ where: { executionId: execution.id } });
            if (second?.generation === 2 && second.status === 'pending') break;
            await delay(500);
          }
          if (second?.id !== recovery.id || second.generation !== 2 || second.status !== 'pending'
            || (await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).status !== 'running')
            throw new Error('Second drain did not require a new owner confirmation');
          const oldClaim = await fetch(`${base}/v1/ai-team/capability-recoveries/${recovery.id}/claim`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ executionId: execution.id, machineId: readyMachine.machineId,
              dispatchToken: execution.dispatchToken, expiredCapability: capability.capability.token,
              generation: 1 }) });
          if (oldClaim.status !== 409) throw new Error('Old recovery generation was claimed');
          const stale = await fetch(`${base}/v1/ai-team/capability-recoveries/${recovery.id}/confirm`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(firstConfirmation) });
          if (stale.status !== 409) throw new Error('Stale recovery generation was confirmed');
          await request(`/v1/ai-team/capability-recoveries/${recovery.id}/confirm`,
            await recoveryHuman.assertion(recovery.id, 2));
          let secondDrain;
          for (let i = 0; i < 120; i++) {
            secondDrain = JSON.parse(readFileSync(capabilityFile, 'utf8'));
            if (secondDrain.recoveryGeneration === 2) break;
            await delay(500);
          }
          if (secondDrain?.recoveryGeneration !== 2 || secondDrain.recoveryId !== recovery.id
            || secondDrain.originalCapability?.token !== capability.capability.token
            || secondDrain.capability.token === firstDrain.capability.token)
            throw new Error('Second drain token or original proof changed');
          finishBlocked = false;
          console.log(JSON.stringify({ result: 'REAL_SECOND_DRAIN_OWNER_RECONFIRMED',
            executionId: execution.id, generation: secondDrain.recoveryGeneration,
            oldRenew: oldRenew.status, oldClaim: oldClaim.status,
            staleConfirmation: stale.status }));
        }
        let terminal;
        for (let i = 0; i < 120; i++) {
          terminal = await db.orchestratorExecution.findUnique({ where: { id: execution.id } });
          if (terminal?.status === 'failed') break;
          await delay(500);
        }
        if (terminal?.status !== 'failed' || terminal.errorCode !== 'EXECUTION_CAPABILITY_EXPIRED'
          || existsSync(join(execution.worktreePath, 'exact.txt')))
          throw new Error('Confirmed capability drain did not fail original execution without side effect');
        await assertObservedProcessesExited(sdkProcess);
        const drained = JSON.parse(readFileSync(capabilityFile, 'utf8'));
        if (drained.capability.recoveryMode !== 'drain'
          || [...drained.capability.allowedOps].sort().join(',') !== 'event,finish,usage')
          throw new Error('Recovery widened execution permissions');
        const terminalRequest = await fetch(`${base}/v1/ai-team/executions/${execution.id}/capabilities/recovery-requests`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ machineId: readyMachine.machineId, dispatchToken: execution.dispatchToken,
            expiredCapability: capability.capability.token }) });
        if (terminalRequest.status !== 409) throw new Error('Terminal execution accepted another recovery');
        console.log(JSON.stringify({ result: 'REAL_EXPIRED_CAPABILITY_CONFIRMED_DRAIN',
          executionId: execution.id, wrongMachine: wrongMachine.status,
          terminalRequest: terminalRequest.status, terminal: terminal.status,
          recoveryMode: drained.capability.recoveryMode, sdkProcessExited: true }));
        throw new Error('CAPABILITY_RECOVERY_VERIFIED');
      }
      if (approvalKill) {
        let decision;
        for (let i = 0; i < 120; i++) {
          decision = await db.aiDecisionRequest.findFirst({ where: { runId, status: 'pending' } });
          if (decision) break;
          await delay(250);
        }
        if (!decision || !String(decision.payload?.summary ?? '').includes('sleep 20'))
          throw new Error('Codex did not request the delayed operation');
        const execution = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: decision.executionId } });
        if (execution.status !== 'running' || !execution.pid || !execution.worktreePath)
          throw new Error('Delayed operation is not bound to a running execution');
        await request(`/v1/ai-team/decisions/${decision.id}/respond`, {
          version: decision.version, clientRequestId: randomUUID(), decision: 'approved' });
        const queueBase = join(home, 'orchestrator-finish-queue');
        let journal;
        let journalPath;
        for (let i = 0; i < 200; i++) {
          const scopes = existsSync(queueBase) ? readdirSync(queueBase) : [];
          for (const scope of scopes) {
            const dir = join(queueBase, scope, 'approvals');
            if (!existsSync(dir)) continue;
            for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.json'))) {
              const candidate = JSON.parse(readFileSync(join(dir, file), 'utf8'));
              if (candidate.executionId === execution.id && candidate.operationId === decision.operationId) {
                journal = candidate; journalPath = join(dir, file); break;
              }
            }
          }
          if (journal?.state === 'invoking') break;
          await delay(25);
        }
        if (journal?.state !== 'invoking') throw new Error('Approved action was not durably marked invoking');
        const daemonPid = JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')).pid;
        process.kill(daemonPid, 'SIGKILL');
        try { process.kill(execution.pid, 'SIGKILL'); } catch { /* Already exited. */ }
        await delay(500);
        daemon = startDaemon();
        daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
        daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
        for (let i = 0; i < 60; i++) {
          const context = await request('/v1/orchestrator/context', undefined, 'GET');
          if (context.data?.machines?.some((machine) => machine.machineId === readyMachine.machineId && machine.dispatchReady)) break;
          await delay(250);
        }
        let after;
        for (let i = 0; i < 120; i++) {
          after = await db.orchestratorExecution.findMany({ where: { taskId: execution.taskId } });
          if (after.length === 1 && after[0].status === 'failed') break;
          await delay(500);
        }
        const persisted = JSON.parse(readFileSync(journalPath, 'utf8'));
        if (after?.length !== 1 || after[0].status !== 'failed'
          || after[0].errorCode !== 'APPROVAL_OUTCOME_UNCERTAIN'
          || persisted.state !== 'invoking' || persisted.acceptedFinish)
          throw new Error('Restart replayed an uncertain approval into a new attempt');
        console.log(JSON.stringify({ result: 'ACTUAL_APPROVAL_INVOKING_DAEMON_KILL_RESTART',
          executionId: execution.id, operationId: decision.operationId, state: persisted.state,
          attempts: after.length, errorCode: after[0].errorCode }));
        throw new Error('APPROVAL_KILL_VERIFIED');
      }
      if (approvalReject) {
        let decision;
        for (let i = 0; i < 240; i++) {
          decision = await db.aiDecisionRequest.findFirst({ where: { runId, status: 'pending' } });
          if (decision) break;
          await delay(500);
        }
        if (!decision) throw new Error('Public Project approval did not request a decision');
        const running = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: decision.executionId } });
        if (running.status !== 'running' || !running.worktreePath || !running.childSessionId
          || existsSync(join(running.worktreePath, 'exact.txt')))
          throw new Error('Public Project action was not paused before write');
        await request(`/v1/ai-team/decisions/${decision.id}/respond`, {
          version: decision.version, clientRequestId: randomUUID(), decision: 'rejected' });
        let terminal;
        for (let i = 0; i < 120; i++) {
          terminal = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId } });
          if (terminal && ['failed', 'completed', 'cancelled', 'timeout'].includes(terminal.status)) break;
          await delay(500);
        }
        if (!['failed', 'cancelled'].includes(terminal?.status)
          || existsSync(join(running.worktreePath, 'exact.txt')))
          throw new Error('Public Project rejection caused side effect or success');
        throw new Error('APPROVAL_REJECTION_VERIFIED');
      }
      const approved = new Set();
      let terminal = false;
      for (let step = 0; step < 12; step++) {
        let decision;
        for (let i = 0; i < 240; i++) {
          decision = await db.aiDecisionRequest.findFirst({ where: { runId,
            status: 'pending', id: { notIn: [...approved] } } });
          if (decision) break;
          const current = await db.orchestratorRun.findUnique({ where: { id: runId }, select: { status: true } });
          if (current && ['completed', 'failed', 'cancelled', 'timeout'].includes(current.status)) {
            terminal = true; break;
          }
          await delay(500);
        }
        if (terminal) break;
        if (!decision || decision.actionType !== 'shell' || !decision.operationId || !decision.actionHash)
          throw new Error('Public Project did not provide a bounded shell approval');
        const summary = String(decision.payload?.summary ?? '');
        if (!summary.startsWith('Shell command starting in task worktree')
          || !summary.includes('<system-bash>')
          || !/\b(?:pwd|git status|ls -l|printf|cmp|od|wc|cat|test)\b/.test(summary)
          || /\b(?:rm|sudo|curl|wget|git push|chmod|chown|eval|printenv)\b/.test(summary))
          throw new Error('Public Project requested an action outside the test allowlist');
        const running = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: decision.executionId } });
        if (running.status !== 'running' || !running.worktreePath || !running.childSessionId)
          throw new Error('Public Project decision lost the original execution identity');
        const file = join(running.worktreePath, 'exact.txt');
        if (step === 0 && existsSync(file)) throw new Error('Public Project wrote before first approval');
        if (existsSync(file) && !readFileSync(file).equals(Buffer.from(exact)))
          throw new Error('Prior approval wrote incorrect bytes');
        await request(`/v1/ai-team/decisions/${decision.id}/respond`, {
          version: decision.version, clientRequestId: randomUUID(), decision: 'approved' });
        approved.add(decision.id);
        console.log(JSON.stringify({ result: 'PUBLIC_PROJECT_OPERATION_APPROVED', step: step + 1,
          executionId: decision.executionId, operationId: decision.operationId }));
      }
      if (!terminal || approved.size < 2)
        throw new Error('Public Project did not finish after distinct bounded approvals');
    } else {
    const rule = await request('/v1/ai-team/autopilots', { projectId: created.id, agentId: agent.id,
      name: `cli-p2-${randomUUID()}`, prompt: claudeProvider
        ? `Create exact.txt with exactly these bytes: ${JSON.stringify(exact)}. Do not edit other files. Reply DONE. Do not create an issue or pull request.`
        : `Create exact.txt with exactly these bytes: ${JSON.stringify(exact)}. Verify with a command that exits nonzero on mismatch. Do not create an issue or pull request.`,
      triggerKind: 'manual', action: 'run_only', concurrencyPolicy: 'queue' });
    await request(`/v1/ai-team/autopilots/${rule.id}/status`, { enabled: true }, 'PATCH');
    const triggered = await request(`/v1/ai-team/autopilots/${rule.id}/run`, { clientRequestId: randomUUID() });
    for (let i = 0; i < 120; i++) {
      const row = await db.aiAutopilotRun.findUnique({ where: { id: triggered.id } });
      if (row?.orchestratorRunId) { runId = row.orchestratorRunId; break; }
      await delay(500);
    }
    if (!runId) throw new Error('Autopilot did not submit a real orchestrator run');
    }
    await db.$disconnect();
  } else {
  const submission = await request('/v1/orchestrator/submit', {
    title: 'P0 CLI exact file test', mode: 'async', idempotencyKey: randomUUID(),
    tasks: [{ taskKey: 'exact-file', provider: claudeProvider ? 'claude' : 'codex', workingDirectory: repo,
      permissionMode: providerTimeout || providerCancel ? 'read_only' : approval ? 'approval' : 'guarded_auto',
      timeoutMs: providerTimeout ? providerTimeoutMs : approvalProviderTimeout ? 45000
        : approval ? 600000 : offlineFinish ? 600000 : 180000,
      target: { type: 'machine_id', machineId: readyMachine.machineId },
      prompt: providerTimeout || providerCancel
        ? 'Provide a detailed, careful technical explanation of Git worktree identity in at least 1000 words. Do not edit any files.'
        : approval
        ? `Use a shell command requiring explicit approval to create exact.txt with exactly these bytes: ${JSON.stringify(exact)}. Do not use apply_patch, workspace-write, or another tool to write. Wait for the specific shell approval. After approval, verify the bytes. Do not commit or create a PR.`
        : claudeProvider
          ? `Create exact.txt with exactly these bytes: ${JSON.stringify(exact)}. Do not edit other files. Reply DONE. Do not create an issue or pull request.`
          : `${offlineFinish ? 'Before editing, run the shell command sleep 20. ' : ''}Create exact.txt with exactly the following bytes, then verify with a command that exits nonzero if any byte differs: ${JSON.stringify(exact)}. Commit exact.txt on this task branch. Do not create an issue or pull request.`,
    }],
  });
  runId = submission.data.runId;
  lifecycleObservation = providerTimeout || providerCancel ? (async () => {
    const db = new PrismaClient();
    try {
      const { observeProvider } = await import('./ai-team-provider-process.mjs');
      return { observed: await observeProvider(db, runId, claudeProvider ? 'claude' : 'codex',
        120_000, claudeProvider ? { root: join(home, 'orchestrator-workspaces'), repository: repo } : null) };
    } catch (error) { return { error }; }
    finally { await db.$disconnect(); }
  })() : null;
  if (providerCancel) {
    const observation = await lifecycleObservation;
    if (observation.error) throw observation.error;
    console.log(JSON.stringify({ result: 'PROVIDER_PROCESS_OBSERVED', kind: 'cancel' }));
    await request(`/v1/orchestrator/runs/${runId}/cancel`, { reason: 'isolated-provider-cancel-test' });
    console.log(JSON.stringify({ result: 'PROVIDER_CANCEL_REQUEST_ACKED' }));
  }
  if (approval) {
    const db = new PrismaClient();
    try {
      const accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
      const task = await db.orchestratorTask.findFirstOrThrow({ where: { runId } });
      const agent = await db.aiAgent.create({ data: { accountId, name: `approval-fixture-${randomUUID()}`,
        role: 'Engineer', description: '', emoji: '', instructions: '', settings: {
          engine: 'codex', model: 'default', instructions: '', workingDirectory: repo,
          permissionMode: 'approval', allowDelegation: false } } });
      const conversation = await db.aiConversation.create({ data: { accountId,
        scopeKey: `approval-fixture-${randomUUID()}`, kind: 'agent', agentId: agent.id,
        title: 'Controlled approval fixture' } });
      await db.aiWorkItem.create({ data: { accountId, title: 'Controlled approval fixture',
        summary: 'Real Server Decision and Codex app-server test', sourceType: 'manual',
        sourceLabel: 'approval-fixture', sourceResourceId: randomUUID(), assigneeId: agent.id,
        conversationId: conversation.id, orchestratorRunId: runId, orchestratorTaskId: task.id } });
      let decision;
      for (let i = 0; i < 240; i++) {
        decision = await db.aiDecisionRequest.findFirst({ where: { runId, status: 'pending' } });
        if (decision) break;
        const current = await db.orchestratorExecution.findFirst({ where: { runId },
          select: { status: true, errorCode: true } });
        if (current && ['failed', 'completed', 'cancelled', 'timeout'].includes(current.status))
          throw new Error(`Approval request absent before execution terminal: ${current.status}/${current.errorCode}`);
        await delay(500);
      }
      if (!decision) throw new Error('Actual Codex app-server did not request operation approval');
      if (existsSync(join(repo, 'exact.txt'))) throw new Error('Source changed before approval');
      const running = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: decision.executionId } });
      if (running.status !== 'running' || !running.childSessionId || !running.worktreePath
        || existsSync(join(running.worktreePath, 'exact.txt')))
        throw new Error('Approval did not pause the original running execution');
      if (!decision.operationId || !decision.actionHash || decision.actionType !== 'shell')
        throw new Error('Approval request lacks actual shell operation identity');
      if (approvalProviderTimeout) {
        const { observeProvider, assertObservedProcessesExited } = await import('./ai-team-provider-process.mjs');
        const sdkProcess = await observeProvider(db, runId, 'codex-app-server');
        if (sdkProcess.executionId !== decision.executionId)
          throw new Error('SDK process belongs to a different execution');
        let terminal;
        for (let attempt = 0; attempt < 180; attempt++) {
          terminal = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId } });
          if (terminal && ['timeout', 'failed', 'cancelled', 'completed'].includes(terminal.status)) break;
          await delay(500);
        }
        await assertObservedProcessesExited(sdkProcess);
        const attempts = await db.orchestratorExecution.count({ where: { taskId: running.taskId } });
        if (!['timeout', 'failed'].includes(terminal?.status) || !['WATCHDOG_TIMEOUT', 'TASK_TIMEOUT'].includes(terminal?.errorCode)
          || attempts !== 1 || existsSync(join(running.worktreePath, 'exact.txt')))
          throw new Error('SDK natural timeout violated execution identity or side-effect boundary');
        console.log(JSON.stringify({ result: 'ACTUAL_APPROVAL_SDK_TIMEOUT_VERIFIED',
          executionId: decision.executionId, attempts, status: terminal.status,
          errorCode: terminal.errorCode, providerProcessExited: true }));
        throw new Error('APPROVAL_SDK_TIMEOUT_VERIFIED');
      }
      const wrong = await fetch(`${base}/v1/ai-team/decisions/${decision.id}/respond`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ version: decision.version + 1, clientRequestId: randomUUID(), decision: 'approved' }) });
      if (wrong.status !== 409) throw new Error(`Wrong decision version was accepted: ${wrong.status}`);
      await request(`/v1/ai-team/decisions/${decision.id}/respond`, {
        version: decision.version, clientRequestId: randomUUID(), decision: approvalReject ? 'rejected' : 'approved' });
      console.log(JSON.stringify({ result: 'ACTUAL_CODEX_APPROVAL_PENDING_AND_DECIDED',
        executionId: decision.executionId, operationId: decision.operationId,
        actionHash: decision.actionHash, requestVersion: decision.version }));
      if (approvalReject) {
        let terminal;
        for (let i = 0; i < 120; i++) {
          terminal = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId } });
          if (terminal && ['failed', 'completed', 'cancelled', 'timeout'].includes(terminal.status)) break;
          await delay(500);
        }
        if (terminal?.status !== 'failed' || existsSync(join(running.worktreePath, 'exact.txt')))
          throw new Error('Rejected operation caused a side effect or completed');
        throw new Error('APPROVAL_REJECTION_VERIFIED');
      }
      let second;
      for (let i = 0; i < 120; i++) {
        second = await db.aiDecisionRequest.findFirst({ where: {
          executionId: decision.executionId, status: 'pending', id: { not: decision.id } } });
        if (second) break;
        await delay(500);
      }
      if (!second || second.operationId === decision.operationId || second.actionHash === decision.actionHash)
        throw new Error('Actual second independent approval was not requested');
      const first = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: decision.id } });
      if (first.deliveryStatus !== 'delivered' || !existsSync(join(running.worktreePath, 'exact.txt')))
        throw new Error('First approved operation did not write before second approval');
      if (!readFileSync(join(running.worktreePath, 'exact.txt')).equals(Buffer.from(exact)))
        throw new Error('First approved operation wrote incorrect bytes');
      await request(`/v1/ai-team/decisions/${second.id}/respond`, {
        version: second.version, clientRequestId: randomUUID(), decision: 'approved' });
      console.log(JSON.stringify({ result: 'ACTUAL_SECOND_OPERATION_INDEPENDENTLY_APPROVED',
        executionId: second.executionId, operationId: second.operationId, requestVersion: second.version }));
    } finally { await db.$disconnect(); }
  }
  }
  if (providerTimeout || providerCancel) {
    const observation = await lifecycleObservation;
    if (observation.error) throw observation.error;
    if (providerTimeout) console.log(JSON.stringify({ result: 'PROVIDER_PROCESS_OBSERVED', kind: 'timeout' }));
    console.log(JSON.stringify({ result: 'PROVIDER_TERMINAL_POLL_STARTED' }));
    let terminal;
    for (let i = 0; i < 120; i++) {
      terminal = (await request(`/v1/orchestrator/runs/${runId}?includeExecutions=true`, undefined, 'GET')).data;
      if (['timeout', 'cancelled', 'failed', 'completed'].includes(terminal.status)) break;
      await delay(500);
    }
    const expectedStatus = providerTimeout ? 'timeout' : 'cancelled';
    const timedOut = providerTimeout && ['failed', 'timeout'].includes(terminal?.status)
      && ['TASK_TIMEOUT', 'WATCHDOG_TIMEOUT'].includes(terminal?.tasks?.[0]?.errorCode);
    const cancelled = providerCancel && terminal?.status === 'cancelled';
    const db = new PrismaClient();
    const actualExecution = await db.orchestratorExecution.findFirst({ where: { runId },
      select: { id: true, pid: true, status: true, errorCode: true,
        worktreePath: true, branchName: true, baseCommit: true, dispatchToken: true } });
    await db.$disconnect();
    console.log(JSON.stringify({ result: 'PROVIDER_TERMINAL_OBSERVED',
      status: actualExecution?.status ?? 'missing', kind: expectedStatus }));
    const { assertObservedProcessesExited } = await import('./ai-team-provider-process.mjs');
    let providerExited = false;
    try { await assertObservedProcessesExited(observation.observed); providerExited = true; }
    catch { /* Keep the full boundary assertion below nonzero. */ }
    if (providerExited) console.log(JSON.stringify({ result: 'PROVIDER_PROCESS_EXITED', kind: expectedStatus }));
    const boundWorktree = !!actualExecution?.worktreePath
      && actualExecution.worktreePath === observation.observed.worktreePath;
    let headMatchesBase = false;
    let worktreeClean = false;
    if (boundWorktree) {
      try {
        headMatchesBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: actualExecution.worktreePath }).toString().trim() === actualExecution.baseCommit;
        worktreeClean = execFileSync('git', ['status', '--porcelain'], { cwd: actualExecution.worktreePath }).length === 0;
      } catch { /* Preserve failure without exposing local paths. */ }
    }
    const checks = {
      terminalStatus: timedOut || cancelled,
      oneExecution: terminal?.tasks?.[0]?.executions?.length === 1,
      originalExecution: actualExecution?.id === observation.observed.executionId,
      oneShotPid: actualExecution?.pid === observation.observed.oneShot.pid,
      worktreeBinding: boundWorktree,
      executionTerminal: providerTimeout
        ? ['timeout', 'failed'].includes(actualExecution?.status) && ['TASK_TIMEOUT', 'WATCHDOG_TIMEOUT'].includes(actualExecution?.errorCode)
        : actualExecution?.status === 'cancelled',
      sourceFileAbsent: !existsSync(join(repo, 'exact.txt')),
      taskFileAbsent: boundWorktree && !existsSync(join(actualExecution.worktreePath, 'exact.txt')),
      headMatchesBase,
      worktreeClean,
      providerExited,
    };
    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    console.log(JSON.stringify({ result: 'PROVIDER_TERMINAL_BOUNDARY_CHECKS', kind: expectedStatus,
      status: actualExecution?.status ?? 'missing', errorCode: actualExecution?.errorCode ?? null,
      failedChecks, providerExited }));
    if (failedChecks.length) throw new Error(`Provider ${expectedStatus} boundary failed: ${failedChecks.join(',')}`);
    await delay(1500);
    const lateDb = new PrismaClient();
    try {
      const attempts = await lateDb.orchestratorExecution.findMany({ where: { runId },
        select: { id: true, status: true, errorCode: true } });
      if (attempts.length !== 1 || attempts[0].id !== actualExecution.id
        || attempts[0].status !== actualExecution.status
        || attempts[0].errorCode !== actualExecution.errorCode)
        throw new Error('Late finish or retry changed the terminated execution');
    } finally { await lateDb.$disconnect(); }
    console.log(JSON.stringify({ result: 'ACTUAL_PROVIDER_TERMINATION_PASS', provider: claudeProvider ? 'claude' : 'codex',
      kind: expectedStatus, runId, executionCount: terminal.tasks[0].executions.length,
      providerProcessObserved: true, providerProcessExited: true, worktreeClean: true,
      lateFinishAndRetryAbsent: true, errorCode: terminal.tasks[0].errorCode ?? null }));
    throw new Error('PROVIDER_TERMINATION_VERIFIED');
  }
  const observedIdentity = identityCheck ? (async () => {
    const db = new PrismaClient();
    try {
      for (let i = 0; i < 480; i++) {
        const execution = await db.orchestratorExecution.findFirst({ where: { runId },
          select: { status: true, childSessionId: true, worktreePath: true, branchName: true } });
        if (execution?.status === 'running' && execution.childSessionId
          && execution.worktreePath && execution.branchName) return execution;
        await delay(250);
      }
      throw new Error('Running execution did not persist its session/worktree/branch identity');
    } finally { await db.$disconnect(); }
  })() : null;
  let offlineReport;
  if (telemetryKill) {
    const queueBase = join(home, 'orchestrator-finish-queue');
    let scope;
    for (let i = 0; i < 180; i++) {
      await delay(1000);
      scope = existsSync(queueBase) && readdirSync(queueBase).find((entry) =>
        readdirSync(join(queueBase, entry)).some((file) => file.endsWith('.json')));
      if (scope) break;
    }
    if (!scope) throw new Error('Actual daemon did not persist finish during telemetry outage');
    const queueRoot = join(queueBase, scope);
    const eventFiles = readdirSync(join(queueRoot, 'events')).filter((file) => file.endsWith('.json'));
    const usageFiles = readdirSync(join(queueRoot, 'usage')).filter((file) => file.endsWith('.json'));
    if (eventFiles.length < 2 || usageFiles.length < 1)
      throw new Error('Actual daemon did not persist tool events and measured usage before SIGKILL');
    const actualDaemonPid = JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')).pid;
    process.kill(actualDaemonPid, 'SIGKILL');
    for (let i = 0; i < 40; i++) {
      try { process.kill(actualDaemonPid, 0); } catch { break; }
      await delay(100);
    }
    telemetryBlocked = false;
    daemon = startDaemon();
    daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
    daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
    console.log(JSON.stringify({ result: 'P3_ACTUAL_DAEMON_KILLED_WITH_PENDING_TELEMETRY',
      pendingEvents: eventFiles.length, pendingUsage: usageFiles.length }));
  }
  if (offlineFinish) {
    let running = false;
    for (let i = 0; i < 60; i++) {
      const result = await request(`/v1/orchestrator/runs/${runId}`, undefined, 'GET');
      if (result.data.status === 'running') { running = true; break; }
      await delay(500);
    }
    if (!running) throw new Error('Offline test task did not start');
    console.log('OFFLINE_READY');
    const queueBase = join(home, 'orchestrator-finish-queue');
    const queued = () => existsSync(queueBase) && readdirSync(queueBase).some((scope) =>
      readdirSync(join(queueBase, scope)).some((file) => file.endsWith('.json')));
    for (let i = 0; i < 180 && !queued(); i++) await delay(1000);
    if (!queued()) throw new Error('Finish report was not persisted while server was offline');
    const scope = readdirSync(queueBase).find((entry) => readdirSync(join(queueBase, entry)).some((file) => file.endsWith('.json')));
    const reportFile = readdirSync(join(queueBase, scope)).find((file) => file.endsWith('.json'));
    offlineReport = JSON.parse(readFileSync(join(queueBase, scope, reportFile), 'utf8'));
    console.log('OFFLINE_QUEUED');
    const actualDaemonPid = JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')).pid;
    if (!Number.isSafeInteger(actualDaemonPid) || actualDaemonPid <= 0) throw new Error('Invalid isolated daemon PID');
    process.kill(actualDaemonPid, 'SIGKILL');
    for (let i = 0; i < 40; i++) {
      try { process.kill(actualDaemonPid, 0); } catch { break; }
      await delay(100);
    }
    console.log('OFFLINE_DAEMON_KILLED');
    if (offlineFinishProxy) finishBlocked = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* server remains offline */ }
      await delay(500);
    }
    daemon = startDaemon();
    daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
    daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
  }
  let run;
  for (let i = 0; i < 180; i++) {
    await delay(1000);
    let result;
    try { result = await request(`/v1/orchestrator/runs/${runId}`, undefined, 'GET'); }
    catch (error) { if (offlineFinish) { await delay(1000); continue; } throw error; }
    run = result.data;
    if (run && ['completed', 'failed', 'cancelled', 'timeout'].includes(run.status)) break;
    if (!offlineFinish && daemon.exitCode !== null) throw new Error(`Isolated daemon exited: ${daemon.exitCode}`);
  }
  if (!run || run.status !== 'completed') throw new Error(`Execution did not complete: ${run?.status ?? 'missing'}`);
  const task = project ? run.tasks?.[0] : run.tasks?.find((item) => item.taskKey === 'exact-file');
  if (project) {
    const db = new PrismaClient();
    const work = await db.aiWorkItem.findFirst({ where: { orchestratorRunId: runId } });
    if (work?.projectId !== projectId || work.projectVersion !== 1)
      throw new Error('Autopilot run did not retain the local Project version');
    if (templateProposal) {
      const execution = await db.orchestratorExecution.findFirstOrThrow({ where: { runId } });
      if (!Number.isSafeInteger(execution.pid) || execution.pid < 1
        || !execution.childSessionId || !execution.worktreePath || !execution.branchName)
        throw new Error('Template execution did not persist its real child identity and PID');
      const proposals = await db.aiAgentTemplateProposal.findMany({ where: {
        templateId, sourceExecutionId: execution.id } });
      if (proposals.length !== 1 || proposals[0].status !== 'pending'
        || proposals[0].sourceAgentId !== work.assigneeId)
        throw new Error('Actual Codex did not create exactly one scoped pending template proposal');
      const template = await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: templateId } });
      if (template.currentVersion !== 1) throw new Error('Agent published a proposal without review');
      const reviewed = await request(`/v1/ai-team/agent-templates/${templateId}/proposals/${proposals[0].id}/review`, {
        decision: templateReject ? 'rejected' : 'accepted', confirmed: true, expectedCurrentVersion: 1 });
      if (reviewed.status !== (templateReject ? 'rejected' : 'accepted'))
        throw new Error('Explicit account review did not return its decision');
      const after = await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: templateId } });
      if (after.currentVersion !== (templateReject ? 1 : 2))
        throw new Error('Review did not preserve the expected template publication boundary');
      console.log(JSON.stringify({ result: 'ACTUAL_CODEX_EXECUTION_TEMPLATE_PROPOSAL_REVIEWED',
        executionId: execution.id, proposalId: proposals[0].id, decision: reviewed.status,
        sourceBound: true, pendingBeforeReview: true }));
    }
    await db.$disconnect();
  }
  const finalResponse = task?.finalResponse ?? task?.outputText;
  if (typeof finalResponse !== 'string' || !finalResponse.trim()) throw new Error('Completed execution has no structured final response');
  if (offlineReport && offlineReport.finalResponse !== finalResponse) throw new Error('Queued final response differs from accepted task output');
  if (/tokens used|you are (an|the) (ai|assistant)|codex (v|cli)|HAPPY_ORCH_PROMPT_B64/i.test(finalResponse))
    throw new Error('Internal runtime text leaked into final response');
  if (offlineFinish) {
    const queueBase = join(home, 'orchestrator-finish-queue');
    const pending = readdirSync(queueBase).flatMap((scope) => readdirSync(join(queueBase, scope)).filter((file) => file.endsWith('.json')));
    if (pending.length !== 0) throw new Error('Finish queue still contains a report after server acknowledgement');
    const capabilityFile = readdirSync(queueBase).map((scope) => join(queueBase, scope, 'capabilities',
      `${createHash('sha256').update(offlineReport.executionId).digest('hex')}.json`))
      .find((candidate) => existsSync(candidate));
    const capability = capabilityFile ? JSON.parse(readFileSync(capabilityFile, 'utf8')).capability.token : undefined;
    const duplicate = await request(`/v1/orchestrator/executions/${offlineReport.executionId}/finish`, {
      ...offlineReport, ...(capability ? { capability } : {}) });
    if (duplicate.data?.duplicate !== true) throw new Error('Original dispatch token was not idempotently acknowledged');
    const wrongOwner = await fetch(`${base}/v1/orchestrator/executions/${offlineReport.executionId}/finish`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...offlineReport, dispatchToken: randomUUID(), ...(capability ? { capability } : {}) }),
    });
    if (wrongOwner.status !== 409) throw new Error(`Wrong dispatch owner was not rejected: HTTP ${wrongOwner.status}`);
  }
  const workspaceRoot = join(home, 'orchestrator-workspaces');
  const records = (await import('node:fs')).readdirSync(workspaceRoot).filter((entry) => entry.startsWith('task-') && entry.endsWith('.json'));
  if (records.length !== 1) throw new Error(`Expected one task workspace, got ${records.length}`);
  const workspace = JSON.parse(readFileSync(join(workspaceRoot, records[0]), 'utf8'));
  if (observedIdentity) {
    const identity = await observedIdentity;
    if (identity.worktreePath !== workspace.worktreePath || identity.branchName !== workspace.branchName
      || !/^[a-zA-Z0-9-]{8,256}$/.test(identity.childSessionId))
      throw new Error('Running execution identity differs from the trusted task workspace');
    console.log(JSON.stringify({ result: 'P3_RUNNING_IDENTITY_BOUND_BEFORE_FINISH',
      sessionId: identity.childSessionId, branch: identity.branchName }));
  }
  const privateCodexHome = join(home, 'orchestrator-codex', (await import('node:crypto')).createHash('sha256').update(workspace.taskId).digest('hex'));
  if (claudeProvider) {
    const privateClaudeHome = join(home, 'orchestrator-claude', createHash('sha256').update(workspace.taskId).digest('hex'));
    if (!existsSync(join(privateClaudeHome, 'binding.json')) || existsSync(join(privateClaudeHome, 'auth.json')))
      throw new Error('Private Claude task home missing or retained copied auth');
  } else if (!existsSync(join(privateCodexHome, 'config.toml')) || existsSync(join(privateCodexHome, 'auth.json')))
    throw new Error('Private Codex home was not used or normal exit retained auth');
  if (templateProposal) {
    const sessions = readdirSync(join(privateCodexHome, 'sessions'), { recursive: true })
      .filter((name) => String(name).endsWith('.jsonl'));
    if (sessions.length !== 1) throw new Error('Template execution did not retain exactly one private model session');
    const actualCalls = readFileSync(join(privateCodexHome, 'sessions', String(sessions[0])), 'utf8')
      .split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
      .filter((item) => item?.type === 'response_item' && item.payload?.type === 'custom_tool_call'
        && typeof item.payload?.input === 'string'
        && item.payload.input.includes('tools.mcp__happy_template__ai_template_propose('));
    if (actualCalls.length !== 1) throw new Error('Actual Codex session did not call the scoped template MCP exactly once');
  }
  if (projectMcp) {
    const roster = execFileSync('codex', ['mcp', 'list'], { cwd: workspace.worktreePath,
      env: { ...env, CODEX_HOME: privateCodexHome }, encoding: 'utf8', timeout: 15_000 });
    if (roster.includes('project_probe') || existsSync(join(root, 'unauthorized-mcp-probe')))
      throw new Error('Project MCP probe escaped the isolated one-shot');
  }
  const actual = templateProposal ? Buffer.alloc(0) : readFileSync(join(workspace.worktreePath, 'exact.txt'));
  if (!templateProposal && !actual.equals(Buffer.from(exact))) throw new Error(`Exact content mismatch: expected ${Buffer.byteLength(exact)} bytes, got ${actual.length}`);
  const branch = git(['-C', workspace.worktreePath, 'branch', '--show-current']).toString().trim();
  const commit = git(['-C', workspace.worktreePath, 'rev-parse', 'HEAD']).toString().trim();
  if (branch !== workspace.branchName || !/^[0-9a-f]{40,64}$/.test(commit)
    || (templateProposal ? commit !== workspace.baseCommit : commit === workspace.baseCommit))
    throw new Error('Worktree Git identity or commit mismatch');
  if (!templateProposal) {
    const committed = git(['-C', workspace.worktreePath, 'show', 'HEAD:exact.txt']);
    if (!committed.equals(Buffer.from(exact))) throw new Error('Committed file content mismatch');
  }
  if (resume) {
    if (legacySession) {
      const sessionDir = join(privateCodexHome, 'sessions');
      const all = readdirSync(sessionDir, { recursive: true }).filter((name) => String(name).endsWith('.jsonl'));
      if (all.length !== 1) throw new Error('Expected one private session before exact migration');
      const relative = String(all[0]);
      const shared = join(codexHome, 'sessions', relative);
      mkdirSync(join(shared, '..'), { recursive: true, mode: 0o700 });
      renameSync(join(sessionDir, relative), shared);
      const daemonPid = JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')).pid;
      process.kill(daemonPid, 'SIGKILL');
      for (let i = 0; i < 40; i++) {
        try { process.kill(daemonPid, 0); } catch { break; }
        await delay(100);
      }
      daemon = startDaemon();
      daemon.stdout.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
      daemon.stderr.on('data', (chunk) => { daemonOutput = `${daemonOutput}${chunk}`.slice(-10000); });
      for (let i = 0; i < 60; i++) {
        const context = await request('/v1/orchestrator/context', undefined, 'GET');
        if (context.data?.machines?.some((machine) => machine.machineId === readyMachine.machineId && machine.dispatchReady)) break;
        await delay(500);
      }
    }
    const resumedExact = `P0_RESUME_${Date.now()}\n`;
    await request(`/v1/orchestrator/tasks/${workspace.taskId}/send-message`, {
      message: claudeProvider
        ? `In this same task session and workspace, create continued.txt with exactly ${JSON.stringify(resumedExact)}. Do not edit other files. Reply DONE. Do not create a PR.`
        : `In this same task session and workspace, create continued.txt with exactly ${JSON.stringify(resumedExact)}. Verify the bytes with a command that exits nonzero on mismatch. Do not create a PR.`,
    });
    let resumed;
    for (let i = 0; i < 180; i++) {
      await delay(1000);
      resumed = (await request(`/v1/orchestrator/runs/${runId}?includeExecutions=true`, undefined, 'GET')).data;
      if (resumed.tasks?.[0]?.executions?.length >= 2 && ['completed', 'failed', 'cancelled', 'timeout'].includes(resumed.status)) break;
    }
    const resumedTask = resumed?.tasks?.find((item) => item.taskId === workspace.taskId);
    const executions = resumedTask?.executions ?? [];
    if (resumed?.status !== 'completed' || resumedTask?.status !== 'completed')
      throw new Error(`Resume failed: ${JSON.stringify({ runStatus: resumed?.status, taskStatus: resumedTask?.status,
        errorCode: resumedTask?.errorCode, errorMessage: resumedTask?.errorMessage,
        attempts: executions.map((item) => ({ status: item.status, errorCode: item.errorCode, exitCode: item.exitCode })) })}`);
    if (executions.length !== 2 || executions[0].childSessionId !== executions[1].childSessionId)
      throw new Error(`Resume did not retain the original model session: ${JSON.stringify(executions.map((item) => ({
        sessionId: item.childSessionId, executionType: item.executionType, status: item.status,
      })))}`);
    const afterRecords = (await import('node:fs')).readdirSync(workspaceRoot).filter((entry) => entry.startsWith('task-') && entry.endsWith('.json'));
    if (afterRecords.length !== 1 || !readFileSync(join(workspace.worktreePath, 'continued.txt')).equals(Buffer.from(resumedExact))
      || git(['-C', workspace.worktreePath, 'branch', '--show-current']).toString().trim() !== branch)
      throw new Error('Resume changed task workspace identity or exact file bytes');
    if (legacySession && readdirSync(join(privateCodexHome, 'sessions'), { recursive: true })
      .filter((name) => String(name).endsWith('.jsonl')).length !== 1)
      throw new Error('Exact legacy session was not restored into the private home');
    console.log(JSON.stringify({ result: 'P0_SAME_TASK_RESUME_PASS', runId, taskId: workspace.taskId,
      sessionId: executions[1].childSessionId, attempts: executions.length, branch, legacySession }));
  }
  if (project) {
    const db = new PrismaClient();
    const executions = await db.orchestratorExecution.findMany({ where: { taskId: workspace.taskId },
      select: { id: true } });
    const events = await db.aiPersistentExecutionEvent.findMany({ where: {
      executionId: { in: executions.map((item) => item.id) } }, select: { executionId: true,
      seq: true, kind: true, phase: true, redactedSummary: true } });
    const usage = await db.aiUsageDelta.findMany({ where: {
      executionId: { in: executions.map((item) => item.id) } }, select: {
      executionId: true, sourceEventId: true, inputTokens: true, outputTokens: true,
      costMicros: true, pricingVersion: true } });
    await db.$disconnect();
    for (const execution of executions) {
      const own = events.filter((item) => item.executionId === execution.id).sort((a, b) => a.seq - b.seq);
      if (!own.some((item) => item.phase === 'finished' && item.kind === 'status')
        || !own.some((item) => item.kind === 'tool' || item.kind === 'result')
        || own.some((item, index) => item.seq !== index + 1))
        throw new Error('Actual runner did not ACK ordered tool and finish events');
    }
    if (events.some((item) => item.kind !== 'status'
      && !/^(shell|file_change|web|tool) (started|updated|completed)( [0-9]+ms)?( (success|failure|unknown))?$/.test(item.redactedSummary)))
      throw new Error('Tool event contains data outside the safe operation summary');
    if (usage.length < executions.length || usage.some((item) => item.inputTokens < 0
      || item.outputTokens < 0 || item.costMicros !== null || item.pricingVersion !== null))
      throw new Error('Actual runner measured usage was not durably ACKed with unknown cost');
    const eventDir = join(home, 'orchestrator-finish-queue');
    const pending = readdirSync(eventDir).flatMap((scope) => {
      const eventsPath = join(eventDir, scope, 'events');
      const usagePath = join(eventDir, scope, 'usage');
      return [...(existsSync(eventsPath) ? readdirSync(eventsPath).filter((file) => file.endsWith('.json')) : []),
        ...(existsSync(usagePath) ? readdirSync(usagePath).filter((file) => file.endsWith('.json')) : [])];
    });
    if (pending.length) throw new Error('Event queue retained records after server ACK');
    console.log(JSON.stringify({ result: claudeProvider ? 'CLAUDE_STREAM_EVENT_USAGE_ACK_PASS' : 'P3_REAL_RUNNER_EVENT_USAGE_ACK_PASS',
      executionCount: executions.length, eventCount: events.length,
      toolEventCount: events.filter((item) => item.kind === 'tool' || item.kind === 'result').length,
      usageCount: usage.length, unknownCost: true }));
    if (telemetryKill) {
      const foreign = nacl.sign.keyPair();
      const challenge = nacl.randomBytes(32);
      const auth = await fetch(`${base}/v1/auth`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: b64(foreign.publicKey), challenge: b64(challenge),
          signature: b64(nacl.sign.detached(challenge, foreign.secretKey)) }) });
      if (!auth.ok) throw new Error('Foreign test account authentication failed');
      const foreignToken = (await auth.json()).token;
      const denied = await fetch(`${base}/v1/ai-team/executions/${executions[0].id}/capabilities`, {
        method: 'POST', headers: { authorization: `Bearer ${foreignToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ allowedOps: ['event'], expiresInSeconds: 300 }),
      });
      if (denied.status !== 404) throw new Error(`Foreign telemetry capability was not denied: HTTP ${denied.status}`);
      console.log(JSON.stringify({ result: 'P3_CROSS_ACCOUNT_TELEMETRY_DENIED', httpStatus: denied.status }));
    }
  }
  console.log(JSON.stringify({ result: 'PASS', mode: offlineFinish ? 'offline-finish' : 'content', accountId: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub, runId, taskId: workspace.taskId, branch, commit, worktreePath: workspace.worktreePath, bytes: actual.length, runStatus: run.status, finalResponseBytes: Buffer.byteLength(finalResponse) }));
  }
} catch (error) {
  if ((providerTimeout || providerCancel) && error instanceof Error && error.message === 'PROVIDER_TERMINATION_VERIFIED') {
    console.log('ACTUAL_PROVIDER_TERMINATION_DID_NOT_COMPLETE_TASK');
  } else if (approvalProviderTimeout && error instanceof Error && error.message === 'APPROVAL_SDK_TIMEOUT_VERIFIED') {
    console.log('ACTUAL_APPROVAL_SDK_TIMEOUT_PASS');
  } else if (approvalProviderCancel && error instanceof Error && error.message === 'APPROVAL_SDK_CANCEL_VERIFIED') {
    console.log('ACTUAL_APPROVAL_SDK_CANCEL_PASS');
  } else if (approvalPendingKill && error instanceof Error && error.message === 'APPROVAL_PENDING_KILL_VERIFIED') {
    console.log('ACTUAL_PENDING_APPROVAL_RESTART_DID_NOT_REPLAY_OPERATION');
  } else if (capabilityRecoveryRevoked && error instanceof Error && error.message === 'CAPABILITY_REVOKED_VERIFIED') {
    console.log('ACTUAL_REVOKED_CAPABILITY_REMAINS_UNDELIVERED');
  } else if (capabilityRecovery && error instanceof Error && error.message === 'CAPABILITY_RECOVERY_VERIFIED') {
    console.log('ACTUAL_CAPABILITY_RECOVERY_REQUIRES_OWNER_CONFIRMATION');
  } else if (approvalKill && error instanceof Error && error.message === 'APPROVAL_KILL_VERIFIED') {
    console.log('ACTUAL_APPROVAL_UNCERTAIN_REQUIRES_REVIEW');
  } else if (approvalReject && error instanceof Error && error.message === 'APPROVAL_REJECTION_VERIFIED') {
    console.log('ACTUAL_CODEX_APPROVAL_REJECTED_WITHOUT_SIDE_EFFECT');
  } else {
    console.error(`P0_REAL_E2E_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} finally {
  await recoveryHuman?.close();
  try {
    const actualDaemonPid = JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')).pid;
    if (Number.isSafeInteger(actualDaemonPid) && actualDaemonPid > 0) process.kill(actualDaemonPid, 'SIGTERM');
  } catch { /* This isolated daemon may already have stopped. */ }
  daemon.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => daemon.once('exit', resolve)), delay(10000)]);
  if (daemon.exitCode === null) daemon.kill('SIGKILL');
  rmSync(join(home, 'access.key'), { force: true });
  rmSync(join(codexHome, 'auth.json'), { force: true });
  rmSync(join(codexHome, 'config.toml'), { force: true });
  if (telemetryProxy) await new Promise((resolve) => telemetryProxy.close(resolve));
  console.log(`P0_TEST_HOME=${home}`);
  process.exit(process.exitCode ?? 0);
}
