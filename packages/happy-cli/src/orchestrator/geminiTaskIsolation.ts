import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '@/configuration';

type Binding = { taskId: string; worktree: string };

export function prepareIsolatedGeminiHome(taskId: string, worktree: string,
  resumeSessionId?: string, authHome = homedir(), privateRoot = configuration.happyHomeDir):
  { path: string; cleanup: () => void } {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(taskId) || !worktree.startsWith('/'))
    throw new Error('SESSION_RECOVERY_REQUIRED: invalid Gemini task identity');
  if (resumeSessionId)
    throw new Error('SESSION_RECOVERY_REQUIRED: exact Gemini private session verification unavailable');
  if (realpathSync(worktree) !== worktree || !lstatSync(worktree).isDirectory())
    throw new Error('SESSION_RECOVERY_REQUIRED: Gemini worktree changed');
  if (existsSync(join(worktree, '.gemini')))
    throw new Error('UNSUPPORTED_CLIENT: Gemini project configuration cannot be isolated');
  const root = join(privateRoot, 'orchestrator-gemini');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, createHash('sha256').update(taskId).digest('hex'));
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()))
    throw new Error('SESSION_RECOVERY_REQUIRED: Gemini home changed');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const configDir = join(path, '.gemini');
  if (existsSync(configDir) && (lstatSync(configDir).isSymbolicLink()
    || !lstatSync(configDir).isDirectory()))
    throw new Error('SESSION_RECOVERY_REQUIRED: Gemini config directory changed');
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const marker = join(path, 'binding.json');
  const binding: Binding = { taskId, worktree };
  if (existsSync(marker)) {
    if (!lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink()
      || readFileSync(marker, 'utf8') !== JSON.stringify(binding))
      throw new Error('SESSION_RECOVERY_REQUIRED: Gemini binding changed');
  } else {
    if (resumeSessionId) throw new Error('SESSION_RECOVERY_REQUIRED: Gemini private session unavailable');
    writeFileSync(marker, JSON.stringify(binding), { mode: 0o600, flag: 'wx' });
  }
  const source = join(authHome, '.gemini', 'oauth_creds.json');
  const sourceSettings = join(authHome, '.gemini', 'settings.json');
  const selectedType = JSON.parse(readFileSync(sourceSettings, 'utf8'))?.security?.auth?.selectedType;
  if (selectedType !== 'oauth-personal')
    throw new Error('GEMINI_AUTH_UNAVAILABLE: unsupported local authentication type');
  if (!existsSync(source) || !lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())
    throw new Error('GEMINI_AUTH_UNAVAILABLE: local OAuth reference unavailable');
  const auth = join(configDir, 'oauth_creds.json');
  if (existsSync(auth)) rmSync(auth);
  try {
    copyFileSync(source, auth);
    const stat = lstatSync(auth);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('GEMINI_AUTH_UNAVAILABLE: unsafe private OAuth copy');
    chmodSync(auth, 0o600);
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ mcpServers: {},
      tools: { enableHooks: false }, security: { auth: { selectedType }, folderTrust: { enabled: false } } }), { mode: 0o600 });
  } catch (error) {
    rmSync(auth, { force: true });
    throw error;
  }
  return { path, cleanup: () => rmSync(auth, { force: true }) };
}
