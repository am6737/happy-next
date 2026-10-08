import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sourcePid = Number(process.env.HAPPY_TEST_PROVIDER_ENV_PID);
if (!Number.isSafeInteger(sourcePid) || sourcePid < 1) throw new Error('Owned provider environment PID required');
const source = `/proc/${sourcePid}`;
if (process.getuid && (await import('node:fs')).statSync(source).uid !== process.getuid())
  throw new Error('Provider environment belongs to another OS user');
const selected = new Set(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']);
const providerEnv = Object.fromEntries(readFileSync(join(source, 'environ')).toString('utf8').split('\0')
  .filter(Boolean).map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)])
  .filter(([key]) => selected.has(key)));
if (!providerEnv.ANTHROPIC_AUTH_TOKEN || !providerEnv.ANTHROPIC_BASE_URL)
  throw new Error('Owned provider process lacks required Anthropic references');
const root = mkdtempSync(join(tmpdir(), 'happy-claude-provider-'));
const home = join(root, 'home');
const repo = join(root, 'repo');
mkdirSync(home, { mode: 0o700 });
mkdirSync(repo, { mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'),
  DISABLE_AUTOUPDATER: '1', ...providerEnv };
const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const exact = `CLAUDE_RESTRICTED_${Date.now()}\n`;
const invoke = (mode, prompt, resume) => {
  const result = spawnSync('claude', ['--safe-mode', '--restricted', '--permission-mode', mode,
    '--output-format', 'json', ...(resume ? ['--resume', resume] : []), '-p', prompt], { cwd: repo, env, encoding: 'utf8',
    timeout: 120_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { /* Classify without logging raw output. */ }
  if (result.status !== 0 || parsed?.is_error || typeof parsed?.result !== 'string') {
    const diagnostic = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.toLowerCase();
    console.log(JSON.stringify({ phase: mode, exit: result.status, signal: result.signal,
      authError: /auth|login|credential|unauthorized|401/.test(diagnostic),
      modelError: /model|404|not found/.test(diagnostic),
      quotaError: /quota|rate limit|429/.test(diagnostic),
      responseBytes: Buffer.byteLength(result.stdout ?? '') }));
    throw new Error('Claude provider probe failed');
  }
  return parsed;
};
try {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'CLI Probe']);
  git(['config', 'user.email', 'cli-probe@example.invalid']);
  writeFileSync(join(repo, 'README.md'), 'Provider probe\n');
  git(['add', '.']); git(['commit', '-q', '-m', 'base']);
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({
    mcpServers: { forbidden_probe: { command: 'false' } } }));
  const plan = invoke('plan', 'Reply with exactly CLAUDE_READ_ONLY_PROBE. Do not call tools or edit files.');
  if (!plan.result.includes('CLAUDE_READ_ONLY_PROBE') || existsSync(join(repo, 'exact.txt')))
    throw new Error('Claude read-only response or workspace check failed');
  const write = invoke('acceptEdits', `Create exact.txt with exactly these bytes: ${JSON.stringify(exact)}. Do not edit other files. Return DONE.`);
  if (!existsSync(join(repo, 'exact.txt')) || !readFileSync(join(repo, 'exact.txt')).equals(Buffer.from(exact)))
    throw new Error('Claude restricted edit did not match exact bytes');
  const changed = git(['status', '--porcelain']).toString().split('\n').filter(Boolean);
  if (changed.some((line) => !line.endsWith(' exact.txt') && !line.endsWith(' .claude/')))
    throw new Error('Claude changed a file outside expected probe paths');
  const resumed = invoke('plan', 'Reply with exactly CLAUDE_RESUME_PROBE. Do not call tools or edit files.', write.session_id);
  if (!resumed.result.includes('CLAUDE_RESUME_PROBE') || resumed.session_id !== write.session_id)
    throw new Error('Claude private session resume failed');
  const sessionFiles = (await import('node:fs')).readdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true })
    .filter((name) => String(name).endsWith(`${write.session_id}.jsonl`));
  if (sessionFiles.length !== 1) throw new Error('Claude private session file missing or ambiguous');
  const stream = spawnSync('claude', ['--safe-mode', '--restricted', '--permission-mode', 'acceptEdits',
    '--output-format', 'stream-json', '--verbose', '-p',
    'Create stream.txt with exactly STREAM_EVENT_PROBE followed by a newline. Reply DONE.'],
  { cwd: repo, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  if (stream.status !== 0 || readFileSync(join(repo, 'stream.txt'), 'utf8') !== 'STREAM_EVENT_PROBE\n')
    throw new Error('Claude stream event probe failed');
  const streamed = stream.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const streamTypes = [...new Set(streamed.map((event) => String(event.type)))];
  const toolNames = [...new Set(streamed.flatMap((event) => event.message?.content ?? [])
    .filter((block) => block?.type === 'tool_use').map((block) => String(block.name)))];
  const eventShapes = streamed.map((event) => ({ type: String(event.type),
    keys: Object.keys(event).filter((key) => !['message', 'result', 'errors'].includes(key)),
    blocks: (event.message?.content ?? []).map((block) => ({ type: String(block.type),
      hasId: typeof block.id === 'string', hasToolUseId: typeof block.tool_use_id === 'string',
      isError: block.is_error === true })) }));
  console.log(JSON.stringify({ result: 'CLAUDE_RESTRICTED_REAL_PASS',
    planSession: typeof plan.session_id === 'string', writeSession: typeof write.session_id === 'string',
    resumeSession: resumed.session_id === write.session_id, privateSessionFiles: sessionFiles.length,
    usageShape: { input: Number.isSafeInteger(write.usage?.input_tokens),
      output: Number.isSafeInteger(write.usage?.output_tokens) },
    bytes: Buffer.byteLength(exact), changedFiles: changed.length,
    streamTypes, toolNames, eventShapes }));
} finally { rmSync(root, { recursive: true, force: true }); }
