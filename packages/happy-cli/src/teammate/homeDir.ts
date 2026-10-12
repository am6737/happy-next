import { execFile } from 'node:child_process';
import { appendFile, chmod, mkdir, open, readFile, rmdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TeammateRunDispatchPayloadSchema, TeammateControllerProviderSchema, type Teammate, type TeammateRunDispatchPayload, type TeammateControllerProvider } from 'happy-wire';
import { configuration } from '@/configuration';
import { encodeBase64, getRandomBytes } from '@/api/encryption';
import { atomicFileWrite } from '@/utils/fileAtomic';
import { delay } from '@/utils/time';
import { INITIAL_HEARTBEAT_MD, INITIAL_MEMORY_MD, INITIAL_USER_MD, renderAgentsMd, renderIdentityMd, renderSoulMd, type TeammateSkillSyncResult } from './templates';
import { dailyLogDate } from './dailyLogDate';

export const execFileAsync = promisify(execFile);

/** IDs become directory and file names. */
export function isPathId(id: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(id);
}

function validatePathId(id: string): void {
    if (!isPathId(id)) {
        throw new Error('Teammate and key IDs must contain only letters, numbers, underscores, or hyphens');
    }
}

export function teammateHomeDir(teammateId: string): string {
    validatePathId(teammateId);
    return resolve(configuration.happyHomeDir, 'agents', teammateId);
}

export interface EnsureTeammateHomeOptions {
    /** Override the home directory, e.g. for an isolated temporary workspace. */
    dir?: string;
    skills?: TeammateSkillSyncResult;
}

export async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

async function createIfMissing(path: string, content: string): Promise<void> {
    try {
        await writeFile(path, content, { flag: 'wx' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
}

async function ensurePrivateDir(path: string): Promise<string> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    return path;
}

/** Sync managed profile files while preserving owner preferences and memories. */
export async function ensureTeammateHome(
    teammate: Teammate,
    opts: EnsureTeammateHomeOptions = {},
): Promise<{ dir: string; created: boolean; committed: boolean }> {
    const dir = opts.dir ? resolve(opts.dir) : teammateHomeDir(teammate.id);
    const created = !await exists(dir);
    await mkdir(dir, { recursive: true });
    for (const subdir of ['memory', 'skills', 'workspaces']) {
        await mkdir(join(dir, subdir), { recursive: true });
    }
    await ensurePrivateDir(join(await ensurePrivateDir(join(dir, 'state')), 'keys'));

    await writeFile(join(dir, 'SOUL.md'), renderSoulMd(teammate));
    await writeFile(join(dir, 'IDENTITY.md'), renderIdentityMd(teammate, opts.skills));
    await writeFile(join(dir, 'AGENTS.md'), renderAgentsMd(teammate, opts.skills));
    await createIfMissing(join(dir, 'USER.md'), INITIAL_USER_MD);
    await createIfMissing(join(dir, 'MEMORY.md'), INITIAL_MEMORY_MD);
    await createIfMissing(join(dir, 'HEARTBEAT.md'), INITIAL_HEARTBEAT_MD);
    await writeFile(join(dir, '.gitignore'), 'state/\nworkspaces/\n.claude/skills/\n.agents/skills/\n');

    // Check for git before initialization; an unavailable git must not prevent setup.
    const gitMissing = await execFileAsync('git', ['--version']).then(() => false, error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
        throw error;
    });
    if (gitMissing) return { dir, created, committed: false };
    const email = `${teammate.handle}@agents.happy.local`;
    const git = (args: string[]) => execFileAsync('git', args, { cwd: dir, env: teammateGitEnv(teammate.name, email) });
    // Do not mistake an ancestor's repository for this teammate's repository.
    if (!await exists(join(dir, '.git'))) await git(['init']);
    await git(['config', '--local', 'user.name', teammate.name]);
    await git(['config', '--local', 'user.email', email]);
    await git(['add', '-A', '--', '.']);
    const { stdout } = await git(['status', '--porcelain']);
    const committed = stdout.trim().length > 0;
    if (committed) await git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'chore: sync profile']);
    return { dir, created, committed };
}

export function isHeartbeatChecklistEmpty(text: string): boolean {
    return text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).every(line => {
        const trimmed = line.trim();
        return !trimmed || /^#{1,6}(?:\s|$)/.test(trimmed) || /^[-*+]\s*(?:\[\s*\])?\s*$/.test(trimmed);
    });
}

function teammateGitEnv(name: string, email: string): NodeJS.ProcessEnv {
    return { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

/** Commit only staged changes in this home repository under its local teammate identity. */
export async function commitTeammateHome(dir: string, message: string): Promise<{ committed: boolean; commit?: string }> {
    const config = (key: string) => execFileAsync('git', ['config', '--local', '--get', key], { cwd: dir });
    const name = (await config('user.name')).stdout.trim();
    const email = (await config('user.email')).stdout.trim();
    if (!name || !email) throw new Error('Teammate git identity is missing');
    const git = (args: string[]) => execFileAsync('git', args, { cwd: dir, env: teammateGitEnv(name, email) });
    await git(['add', '-A', '--', '.']);
    const { stdout } = await git(['diff', '--cached', '--name-only']);
    if (!stdout.trim()) return { committed: false };
    await git(['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
    return { committed: true, commit: (await git(['rev-parse', 'HEAD'])).stdout.trim() };
}

export interface DailyLogEntry {
    text: string;
    runId?: string;
    sessionId?: string;
    at?: Date;
}

export async function appendDailyLog(dir: string, { text, runId, sessionId, at = new Date() }: DailyLogEntry): Promise<void> {
    const memoryDir = join(dir, 'memory');
    await mkdir(memoryDir, { recursive: true });
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const sources = [runId ? `run ${runId}` : '', sessionId ? `session ${sessionId}` : ''].filter(Boolean);
    const suffix = sources.length ? ` (${sources.join(', ')})` : '';
    const date = dailyLogDate(at);
    const path = join(memoryDir, `${date}.md`);
    await createIfMissing(path, `# ${date}\n\n`);
    await appendFile(path, `- ${time} ${text}${suffix}\n`);
}

export type ThreadsState = Record<string, {
    providerSessionId?: string;
    /** Provider of providerSessionId; absent for threads created when controllers always ran on Claude. */
    provider?: TeammateControllerProvider;
    /** Provider and profile env of the live controller, to replace it when either changes. */
    controllerConfig?: string;
    currentSessionId?: string;
    lastActiveAt?: number;
    pid?: number;
    keyPath?: string;
    lastDispatchAt?: number;
    lastRunId?: string;
    lastDispatchToken?: string;
    resetAppliedAt?: number;
    controlToken?: string;
    channel?: TeammateRunDispatchPayload['channel'];
    teammate?: Teammate;
    task?: TeammateRunDispatchPayload['task'];
    teammateName?: string;
    chatSendCounter?: number;
    taskCreateCounter?: number;
    contextTokens?: number;
    contextWindow?: number;
    compactions?: number;
    overflowed?: boolean;
}>;

export async function readThreadsState(dir: string): Promise<ThreadsState> {
    try {
        const state: unknown = JSON.parse(await readFile(join(dir, 'state', 'threads.json'), 'utf8'));
        if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
        for (const value of Object.values(state)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)
                || (value.providerSessionId !== undefined && typeof value.providerSessionId !== 'string')
                || (value.currentSessionId !== undefined && typeof value.currentSessionId !== 'string')
                || (value.pid !== undefined && (!Number.isInteger(value.pid) || value.pid <= 0))
                || (value.keyPath !== undefined && typeof value.keyPath !== 'string')
                || (value.lastDispatchAt !== undefined && typeof value.lastDispatchAt !== 'number')
                || (value.provider !== undefined && !TeammateControllerProviderSchema.safeParse(value.provider).success)
                || ['lastRunId', 'lastDispatchToken', 'controlToken', 'teammateName', 'controllerConfig'].some(key => value[key] !== undefined && typeof value[key] !== 'string')
                || ['resetAppliedAt', 'chatSendCounter', 'taskCreateCounter'].some(key => value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < 0))
                || (value.channel !== undefined && !TeammateRunDispatchPayloadSchema.shape.channel.safeParse(value.channel).success)
                || (value.teammate !== undefined && !TeammateRunDispatchPayloadSchema.shape.teammate.safeParse(value.teammate).success)
                || (value.task !== undefined && !TeammateRunDispatchPayloadSchema.shape.task.safeParse(value.task).success)
                || (value.lastActiveAt !== undefined && typeof value.lastActiveAt !== 'number')) return {};
        }
        return state as ThreadsState;
    } catch {
        return {};
    }
}

/** Atomic replacement keeps readers from seeing partial JSON. */
async function writeStateFile(path: string, state: unknown): Promise<void> {
    await atomicFileWrite(path, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/** Shared filesystem lock for daemon and provider-process read/modify/write. */
async function withStateLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 10_000;
    for (;;) {
        try { await mkdir(lockPath, { mode: 0o700 }); break; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const lockStat = await stat(lockPath).catch(() => null);
            if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) await rmdir(lockPath).catch(() => {});
            if (Date.now() >= deadline) throw new Error('Timed out acquiring teammate state lock');
            await delay(20);
        }
    }
    try { return await work(); } finally { await rmdir(lockPath); }
}

export async function writeThreadsState(dir: string, state: ThreadsState): Promise<void> {
    await writeStateFile(join(await ensurePrivateDir(join(dir, 'state')), 'threads.json'), state);
}

export async function mergeThreadState(dir: string, threadId: string, patch: ThreadsState[string]): Promise<void> {
    await withStateLock(join(await ensurePrivateDir(join(dir, 'state')), 'threads.lock'), async () => {
        const state = await readThreadsState(dir);
        state[threadId] = { ...state[threadId], ...patch };
        await writeThreadsState(dir, state);
    });
}

export interface TaskWorker {
    sessionId: string; keyPath: string; pid?: number; provider: 'claude' | 'codex' | 'gemini';
    repo: string; basePath: string; worktreePath: string; branch: string; baseBranch?: string; title: string;
    /** Review workers report a review, not a result block, and their branch is not the PR branch. */
    review?: boolean;
    providerSessionId?: string; startedAt: number; lastSentAt?: number; stoppedAt?: number;
}
export interface TaskState { workers: Record<string, TaskWorker>; sendCounter?: number }

export async function readTaskState(dir: string, taskId: string): Promise<TaskState> {
    validatePathId(taskId);
    try {
        const state = JSON.parse(await readFile(join(dir, 'state', 'tasks', `${taskId}.json`), 'utf8'));
        if (!state || typeof state.workers !== 'object' || !state.workers || Array.isArray(state.workers)) throw new Error('Invalid task state');
        return state;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workers: {} };
        throw error;
    }
}

export async function updateTaskState<T>(dir: string, taskId: string, update: (state: TaskState) => T): Promise<T> {
    validatePathId(taskId);
    const tasksDir = await ensurePrivateDir(join(await ensurePrivateDir(join(dir, 'state')), 'tasks'));
    return withStateLock(join(tasksDir, `${taskId}.lock`), async () => {
        const state = await readTaskState(dir, taskId);
        const result = update(state);
        await writeStateFile(join(tasksDir, `${taskId}.json`), state);
        return result;
    });
}

export async function mergeTaskWorker(dir: string, taskId: string, workerId: string, patch: Partial<TaskWorker>): Promise<void> {
    validatePathId(workerId);
    await updateTaskState(dir, taskId, state => {
        state.workers[workerId] = { ...state.workers[workerId], ...patch } as TaskWorker;
    });
}

export async function writeSessionKeyFile(dir: string, keyId: string, key: Uint8Array): Promise<string> {
    validatePathId(keyId);
    if (key.length !== 32) throw new Error('Session data key must be exactly 32 bytes');
    const keysDir = await ensurePrivateDir(join(await ensurePrivateDir(join(resolve(dir), 'state')), 'keys'));
    const path = join(keysDir, `${keyId}.key`);
    const file = await open(path, 'w', 0o600);
    try {
        // chmod also repairs permissions on a pre-existing file before writing its key.
        await file.chmod(0o600);
        await file.writeFile(encodeBase64(key), 'utf8');
    } finally {
        await file.close();
    }
    return path;
}

export async function generateSessionKeyFile(dir: string, keyId: string): Promise<{ path: string; key: Uint8Array }> {
    const key = getRandomBytes(32);
    const path = await writeSessionKeyFile(dir, keyId, key);
    return { path, key };
}
