import { homedir } from 'node:os';
import { join } from 'node:path';

export function getCodexHomeDir(
    homeDir: string = homedir(),
    env: NodeJS.ProcessEnv = process.env,
): string {
    return env.CODEX_HOME || join(homeDir, '.codex');
}
