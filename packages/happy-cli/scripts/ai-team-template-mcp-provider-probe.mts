import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeCodexConfig } from '../src/orchestrator/codexIsolation';

const bridge = process.env.HAPPY_TEST_TEMPLATE_BRIDGE;
const trust = process.argv[2];
if (!bridge || !existsSync(bridge) || !['trusted', 'untrusted'].includes(trust))
  throw new Error('Owned bridge path and trust choice are required');
const root = mkdtempSync(join(tmpdir(), 'happy-template-provider-'));
chmodSync(root, 0o700);
const home = join(root, 'codex-home');
const repo = join(root, 'repo');
mkdirSync(home, { mode: 0o700 }); mkdirSync(repo, { mode: 0o700 });
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git(['init']); git(['config', 'user.name', 'CLI Probe']);
git(['config', 'user.email', 'probe@example.invalid']);
writeFileSync(join(repo, 'README.md'), 'Probe repository\n');
git(['add', '.']); git(['commit', '-m', 'initial']);
const source = process.env.CODEX_HOME || join(homedir(), '.codex');
writeFileSync(join(home, 'config.toml'), `${safeCodexConfig(join(source, 'config.toml'))}\n[projects.${JSON.stringify(repo)}]\ntrust_level = ${JSON.stringify(trust)}\n`, { mode: 0o600 });
copyFileSync(join(source, 'auth.json'), join(home, 'auth.json'));
chmodSync(join(home, 'auth.json'), 0o600);
let calls = 0;
const socket = join(root, 'probe.sock');
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk.toString();
  try {
    const parsed = JSON.parse(body);
    if (req.method !== 'POST' || req.url !== '/propose' || parsed.clientRequestId !== 'probe-1'
      || parsed.content?.instructions !== 'Verify exact bytes') throw new Error('invalid');
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'probe-pending', status: 'pending', duplicate: calls > 1 }));
  } catch { res.writeHead(409); res.end('{}'); }
});
await new Promise<void>(resolve => server.listen(socket, resolve));
let child: ReturnType<typeof spawn> | undefined;
try {
  const config = `mcp_servers.happy_template={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(resolve(bridge))}],env={HAPPY_ORCH_BRIDGE_TOOL="template",HAPPY_ORCH_TEMPLATE_SOCKET=${JSON.stringify(socket)}},required=true,enabled_tools=["ai_template_propose"],tools={ai_template_propose={approval_mode="approve"}}}`;
  child = spawn('codex', ['-c', config, '--ask-for-approval', 'never', 'exec', '--json', '--sandbox', 'read-only',
    'Call the ai_template_propose MCP tool directly once with clientRequestId probe-1, content role Reviewer, description Review changes, emoji empty, skills and responsibilities empty arrays, instructions Verify exact bytes, note Probe. Do not run shell commands or inspect files. Then finish.'],
  { cwd: repo, env: { ...process.env, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout?.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 2_000_000) child?.kill('SIGTERM'); });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  let timeout: NodeJS.Timeout | undefined;
  const code = await Promise.race([
    new Promise<number | null>(resolve => child!.once('exit', resolve)),
    new Promise<null>(resolve => { timeout = setTimeout(() => { child?.kill('SIGTERM'); resolve(null); }, 90_000); }),
  ]);
  if (timeout) clearTimeout(timeout);
  const items = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const mcpCalls = items.filter(item => item.type === 'item.started'
    && item.item?.type === 'mcp_tool_call').length;
  console.log(JSON.stringify({ trust, exitCode: code, socketCalls: calls, mcpCalls,
    providerErrorClass: /mcp.*(failed|error)/i.test(stderr) ? 'MCP_STARTUP_ERROR' : null }));
  if (calls !== 1 || mcpCalls < 1 || code !== 0) process.exitCode = 1;
} finally {
  child?.kill('SIGTERM');
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(join(home, 'auth.json'), { force: true });
  console.log(JSON.stringify({ probeId: randomUUID().slice(0, 8), authCopyRemoved: !existsSync(join(home, 'auth.json')) }));
}
