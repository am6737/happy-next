import { constants, createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createInterface as createLineReader } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { readSettings, updateSettings } from '@/persistence';
import { CodexCliSelectionCancelledError, CodexCliUsageError } from './cli';

type DirectoryMode = 'session' | 'current';
type DirectoryChoice = { mode: DirectoryMode; remember: boolean };

// A session can have changed directories since its initial session_meta record.
export async function readCodexResumeDirectory(file: string): Promise<string | null> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const lines = createLineReader({ input: stream, crlfDelay: Infinity });
  let directory: string | null = null;
  try {
    for await (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const cwd = record?.payload?.cwd;
      if (typeof cwd !== 'string' || !isAbsolute(cwd)) continue;
      if (record.type === 'turn_context' || (record.type === 'session_meta' && !directory)) {
        directory = cwd;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return directory;
}

const safeText = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

async function promptDirectory(session: string, current: string): Promise<DirectoryChoice | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nChoose working directory to resume this session\n');
    console.log('  Session = latest cwd recorded in the resumed session');
    console.log('  Current = your current working directory\n');
    console.log(`  1. Use session directory (${safeText(session)})`);
    console.log(`  2. Use current directory (${safeText(current)})`);
    console.log('  3. Always use session directory');
    console.log('  4. Always use current directory');
    console.log('\n  Saved preferences apply only to Happy. Use --resume-cwd ask to choose again.');
    while (true) {
      const answer = (await rl.question('Enter a number, or q to cancel: ')).trim();
      if (answer.toLowerCase() === 'q') return null;
      if (['1', '2', '3', '4'].includes(answer)) {
        return { mode: answer === '1' || answer === '3' ? 'session' : 'current', remember: Number(answer) >= 3 };
      }
      console.log('Enter a number from 1 to 4, or q to cancel.');
    }
  } finally {
    rl.close();
  }
}

const defaultDependencies = {
  readDirectory: readCodexResumeDirectory,
  readPreference: async (): Promise<DirectoryMode | undefined> => {
    const preference = (await readSettings()).codexResumeCwd;
    return preference === 'session' || preference === 'current' ? preference : undefined;
  },
  savePreference: async (mode: DirectoryMode) => {
    await updateSettings(settings => ({ ...settings, codexResumeCwd: mode }));
  },
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prompt: promptDirectory,
  normalize: async (directory: string) => realpath(directory).catch(() => resolve(directory)),
  validate: async (directory: string) => {
    if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory');
    await access(directory, constants.X_OK);
  },
};

export async function resolveCodexResumeDirectory(
  file: string,
  currentDirectory: string,
  override?: DirectoryMode | 'ask',
  dependencies = defaultDependencies,
): Promise<string> {
  const current = resolve(currentDirectory);
  const mode = override ?? await dependencies.readPreference();
  let choice: DirectoryChoice = { mode: 'current', remember: false };
  let session: string | null = null;
  if (mode !== 'current') {
    session = await dependencies.readDirectory(file);
    if (!session && mode === 'session') {
      throw new CodexCliUsageError('No working directory recorded in this session. Use --resume-cwd current.');
    }
    if (session) {
      if (mode === 'session' || await dependencies.normalize(session) === await dependencies.normalize(current)) {
        choice = { mode: 'session', remember: false };
      } else {
        if (!dependencies.isInteractive()) {
          throw new CodexCliUsageError('Resume directory differs from current directory. Use --resume-cwd session or --resume-cwd current in non-interactive mode.');
        }
        const selected = await dependencies.prompt(session, current);
        if (!selected) throw new CodexCliSelectionCancelledError();
        choice = selected;
      }
    }
  }
  const directory = choice.mode === 'session' ? session! : current;
  try {
    await dependencies.validate(directory);
  } catch {
    throw new CodexCliUsageError(`Cannot use resume working directory: ${safeText(directory)}. Check that it exists and is accessible, or use --resume-cwd current.`);
  }
  if (choice.remember) await dependencies.savePreference(choice.mode);
  return directory;
}
