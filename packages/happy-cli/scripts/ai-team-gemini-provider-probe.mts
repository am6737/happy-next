import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'happy-gemini-probe-'));
const home = join(root, 'gemini-home');
const configDir = join(home, '.gemini');
const repo = join(root, 'repo');
mkdirSync(home, { mode: 0o700 }); mkdirSync(repo, { mode: 0o700 });
mkdirSync(configDir, { mode: 0o700 });
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git(['init']); git(['config', 'user.name', 'Gemini Probe']);
git(['config', 'user.email', 'gemini-probe@example.invalid']);
git(['commit', '--allow-empty', '-m', 'initial']);
const source = join(process.env.HOME!, '.gemini', 'oauth_creds.json');
if (!existsSync(source)) throw new Error('GEMINI_AUTH_UNAVAILABLE');
const { copyFileSync, chmodSync } = await import('node:fs');
copyFileSync(source, join(configDir, 'oauth_creds.json'));
chmodSync(join(configDir, 'oauth_creds.json'), 0o600);
writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ mcpServers: {},
  tools: { enableHooks: false }, security: { auth: { selectedType:
    JSON.parse(readFileSync(join(process.env.HOME!, '.gemini', 'settings.json'), 'utf8')).security.auth.selectedType },
    folderTrust: { enabled: false } } }), { mode: 0o600 });
let child: ReturnType<typeof spawn> | undefined;
try {
  const env = { ...process.env, GEMINI_CLI_HOME: home };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_API_KEY; delete env.GOOGLE_APPLICATION_CREDENTIALS;
  child = spawn(process.env.HAPPY_TEST_GEMINI_BIN || 'gemini', ['--approval-mode', 'plan', '--output-format', 'stream-json',
    '-p', 'Reply with exactly GEMINI_PROBE_OK. Do not call tools.'],
  { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); if (output.length > 1_000_000) child?.kill(); });
  let diagnostic = '';
  child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-8_000); });
  const timeout = setTimeout(() => child?.kill(), 90_000);
  const exitCode = await new Promise<number | null>(resolve => child!.once('exit', resolve));
  clearTimeout(timeout);
  const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const types = events.map(item => item.type);
  const response = events.filter(item => item.type === 'result').map(item => item.response);
  const errorClass = /credential|authentication|unauthorized|login|oauth|auth method/i.test(diagnostic)
    ? 'AUTH_CONFIGURATION' : /settings|configuration|invalid config/i.test(diagnostic)
      ? 'CONFIGURATION' : /trust|workspace/i.test(diagnostic)
        ? 'WORKSPACE_TRUST' : /network|fetch|connection|ECONN/i.test(diagnostic)
          ? 'NETWORK' : diagnostic ? 'PROVIDER_DIAGNOSTIC' : null;
  const safeFirstLine = diagnostic.split('\n').find(line => line.trim())?.trim()
    .replace(/(?:https?:\/\/|\/)[^\s]+/g, '[path]')
    .replace(/[A-Za-z0-9_+\/-]{20,}/g, '[redacted]')
    .slice(0, 120) ?? null;
  const safeLastLine = diagnostic.split('\n').filter(line => line.trim() && !/^\s*at\s/.test(line)).at(-1)?.trim()
    .replace(/(?:https?:\/\/|\/)[^\s]+/g, '[path]')
    .replace(/[A-Za-z0-9_+\/-]{20,}/g, '[redacted]')
    .slice(0, 120) ?? null;
  console.log(JSON.stringify({ exitCode, eventTypes: types, exactResponse: response.includes('GEMINI_PROBE_OK'),
    errorClass, safeFirstLine, safeLastLine, authHints: { expired: /expired/i.test(diagnostic), login: /login|log in/i.test(diagnostic),
      unavailable: /unavailable/i.test(diagnostic), selected: /selected|method/i.test(diagnostic),
      missing: /missing|not found|ENOENT/i.test(diagnostic), invalid: /invalid/i.test(diagnostic),
      refresh: /refresh/i.test(diagnostic), account: /account/i.test(diagnostic),
      http401: /\b401\b/.test(diagnostic), http403: /\b403\b/.test(diagnostic),
      oauthPersonal: /oauth-personal/i.test(diagnostic), noAuth: /no authentication|no auth/i.test(diagnostic),
      sandbox: /sandbox/i.test(diagnostic), permission: /permission/i.test(diagnostic),
      model: /model/i.test(diagnostic), quota: /quota/i.test(diagnostic),
      project: /project/i.test(diagnostic), node: /node/i.test(diagnostic),
      timeout: /timeout/i.test(diagnostic), request: /request/i.test(diagnostic),
      proxy: /proxy/i.test(diagnostic), certificate: /certificate/i.test(diagnostic),
      tls: /tls/i.test(diagnostic), fetch: /fetch/i.test(diagnostic),
      trust: /trust/i.test(diagnostic), tool: /tool/i.test(diagnostic) },
    privateAuthRemoved: true }));
  if (exitCode !== 0 || !response.includes('GEMINI_PROBE_OK')) process.exitCode = 1;
} finally {
  child?.kill();
  rmSync(join(configDir, 'oauth_creds.json'), { force: true });
  rmSync(root, { recursive: true, force: true });
}
