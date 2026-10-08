import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { prepareIsolatedCodexHome } from './codexIsolation';
import { prepareIsolatedClaudeHome } from './claudeTaskIsolation';
import { prepareIsolatedGeminiHome } from './geminiTaskIsolation';
import { loadLocalExecutionWorkspace } from './workspace';
import { configuration } from '@/configuration';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeCliPath } from '@/claude/claudeLocal';
import { codexPackage } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';
import { runCodexApproval } from './codexApprovalRunner';
import { EXECUTION_PROCESS_MARKER, ExecutionProcessGroup } from './executionProcessGroup';
import { logger } from '@/ui/logger';
import { MODEL_MODE_DEFAULT, isModelModeForAgent, parseCodexModelMode, parseClaudeModelMode } from 'happy-wire';
import {
  ORCHESTRATOR_ENV_KEYS,
  type OrchestratorProvider,
  decodePromptFromBase64,
  isOrchestratorProvider,
} from './common';

type SpawnPlan = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

function parseProvider(providerArg: string | undefined): OrchestratorProvider {
  if (!providerArg || !isOrchestratorProvider(providerArg)) {
    throw new Error(`Invalid --provider value: ${providerArg ?? '(missing)'}`);
  }
  return providerArg;
}

function readPromptFromEnv(): string {
  const promptB64 = process.env[ORCHESTRATOR_ENV_KEYS.promptB64];
  if (!promptB64) {
    throw new Error(`${ORCHESTRATOR_ENV_KEYS.promptB64} is required`);
  }
  return decodePromptFromBase64(promptB64);
}

function readWorkingDirectoryFromEnv(): string | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.workingDirectory];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

function readModelModeFromEnv(): string | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.modelMode];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

function readExecutionTypeFromEnv(): 'initial' | 'resume' {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.executionType];
  if (value === 'resume') {
    return 'resume';
  }
  return 'initial';
}

function readChildSessionIdFromEnv(): string | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.childSessionId];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

function readPermissionModeFromEnv(): 'read_only' | 'approval' | 'guarded_auto' | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.permissionMode];
  return value === 'read_only' || value === 'approval' || value === 'guarded_auto' ? value : undefined;
}

export function buildSpawnPlan(
  provider: OrchestratorProvider,
  prompt: string,
  workingDirectory?: string,
  modelMode?: string,
  executionType: 'initial' | 'resume' = 'initial',
  childSessionId?: string,
  permissionMode: 'read_only' | 'approval' | 'guarded_auto' = 'guarded_auto',
): SpawnPlan {
  if (permissionMode === 'approval') {
    throw new Error('Headless approval requires an interactive approval channel; execution was not started');
  }
  if (executionType === 'resume' && !childSessionId) {
    throw new Error('childSessionId is required for resume execution');
  }
  const normalizedModelMode = modelMode === MODEL_MODE_DEFAULT ? undefined : modelMode;
  switch (provider) {
    case 'claude': {
      const baseArgs = [claudeCliPath, '--safe-mode', '--restricted', '--permission-mode', permissionMode === 'read_only' ? 'plan' : 'acceptEdits', '--output-format', 'stream-json', '--verbose'];
      if (executionType === 'resume') {
        baseArgs.push('--resume', childSessionId!, '-p', prompt);
      } else {
        if (normalizedModelMode) {
          if (isModelModeForAgent('claude', normalizedModelMode)) {
            const parsed = parseClaudeModelMode(normalizedModelMode as any);
            if (parsed.family !== MODEL_MODE_DEFAULT) {
              baseArgs.push('--model', parsed.family);
              if (parsed.effort) {
                baseArgs.push('--effort', parsed.effort);
              }
            }
          } else {
            baseArgs.push('--model', normalizedModelMode);
          }
        }
        if (childSessionId) baseArgs.push('--session-id', childSessionId);
        baseArgs.push('-p', prompt);
      }
      return {
        command: process.execPath,
        args: baseArgs,
        cwd: workingDirectory,
        env: {
          ...process.env,
          DISABLE_AUTOUPDATER: '1',
        },
      };
    }
    case 'codex': {
      const codexArgs = ['--ask-for-approval', 'never', 'exec', '--json'];
      if (process.env.HAPPY_ORCH_TEMPLATE_SOCKET) {
        const bridge = fileURLToPath(new URL('./codex/happyMcpStdioBridge.mjs', import.meta.url));
        if (!existsSync(bridge)) throw new Error('Template proposal MCP bridge is unavailable');
        codexArgs.unshift('-c', `mcp_servers.happy_template={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(bridge)}],env={HAPPY_ORCH_BRIDGE_TOOL="template",HAPPY_ORCH_TEMPLATE_SOCKET=${JSON.stringify(process.env.HAPPY_ORCH_TEMPLATE_SOCKET)}},required=true,enabled_tools=["ai_template_propose"],tools={ai_template_propose={approval_mode="approve"}}}`);
      }
      if (process.env.HAPPY_ORCH_LEADER_PROXY_URL && process.env.HAPPY_ORCH_LEADER_CAPABILITY) {
        const bridge = fileURLToPath(new URL('./codex/happyMcpStdioBridge.mjs', import.meta.url));
        if (!existsSync(bridge)) throw new Error('Leader delegation MCP bridge is unavailable');
        codexArgs.unshift('-c', `mcp_servers.happy_leader={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(bridge)}],env={HAPPY_ORCH_LEADER_PROXY_URL=${JSON.stringify(process.env.HAPPY_ORCH_LEADER_PROXY_URL)},HAPPY_ORCH_LEADER_CAPABILITY=${JSON.stringify(process.env.HAPPY_ORCH_LEADER_CAPABILITY)}},required=true,enabled_tools=["ai_team_delegate"],tools={ai_team_delegate={approval_mode="approve"}}}`);
      }
      codexArgs.push('--sandbox', permissionMode === 'read_only' ? 'read-only' : 'workspace-write');
      if (executionType === 'resume') {
        codexArgs.push('resume', childSessionId!, prompt);
      } else {
        codexArgs.push(prompt);
        if (normalizedModelMode) {
          if (isModelModeForAgent('codex', normalizedModelMode)) {
            const parsed = parseCodexModelMode(normalizedModelMode);
            if (parsed.family !== MODEL_MODE_DEFAULT) {
              codexArgs.push('--model', parsed.family);
              if (parsed.effort) {
                codexArgs.push('-c', `model_reasoning_effort=${parsed.effort}`);
              }
            }
          } else {
            codexArgs.push('--model', normalizedModelMode);
          }
        }
      }
      const runtime = resolveCodexRuntime(codexPackage(), codexArgs);
      return {
        command: runtime.command,
        args: runtime.args,
        cwd: workingDirectory,
        env: { ...process.env },
      };
    }
    case 'gemini': {
      if (permissionMode !== 'read_only')
        throw new Error('UNSUPPORTED_CLIENT: Gemini headless write sandbox is not verified');
      const geminiArgs = ['--approval-mode', permissionMode === 'read_only' ? 'plan' : 'auto_edit', '--output-format', 'stream-json'];
      if (executionType === 'resume') {
        geminiArgs.push('--resume', childSessionId!, '-p', prompt);
      } else {
        geminiArgs.push('-p', prompt);
        if (normalizedModelMode) {
          geminiArgs.push('--model', normalizedModelMode);
        }
      }
      return {
        command: 'gemini',
        args: geminiArgs,
        cwd: workingDirectory,
        env: { ...process.env },
      };
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function spawnAndWait(plan: SpawnPlan): Promise<number> {
  if (plan.cwd && !existsSync(plan.cwd)) {
    throw new Error(`Working directory does not exist: ${plan.cwd}`);
  }
  return new Promise<number>((resolve, reject) => {
    const daemonOwned = Boolean(process.env[EXECUTION_PROCESS_MARKER]);
    const marker = daemonOwned ? process.env[EXECUTION_PROCESS_MARKER]! : randomUUID();
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...(plan.env ?? process.env), [EXECUTION_PROCESS_MARKER]: marker },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !daemonOwned && process.platform !== 'win32',
    });
    let cleanup = () => {};
    child.once('error', (error) => { cleanup(); reject(error); });
    let group: ExecutionProcessGroup | null = null;
    if (!daemonOwned && child.pid) {
      try { group = new ExecutionProcessGroup(child, marker); }
      catch (error) {
        child.once('close', () => reject(error));
        child.kill('SIGKILL');
        return;
      }
    }
    let killTimer: NodeJS.Timeout | undefined;
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (group) group.signal(signal);
      else child.kill(signal);
      if (!killTimer) killTimer = setTimeout(() => {
        if (group) group.signal('SIGKILL');
        else child.kill('SIGKILL');
      }, 4_000);
    };
    const onTerm = () => forwardSignal('SIGTERM');
    const onInt = () => forwardSignal('SIGINT');
    process.on('SIGTERM', onTerm);
    process.on('SIGINT', onInt);
    cleanup = () => {
      process.off('SIGTERM', onTerm);
      process.off('SIGINT', onInt);
      if (killTimer) clearTimeout(killTimer);
    };

    child.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.once('exit', async (code) => {
      if (group && code === 0) await group.waitForNaturalExit(5_000);
      const settled = group ? await group.settle(4_000) : { exited: true, lingered: false };
      cleanup();
      if (!settled.exited) { reject(new Error('Provider process group did not exit')); return; }
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

function readProviderFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') {
      return args[i + 1];
    }
  }
  return undefined;
}

export async function runOrchestratorOneShot(args: string[]): Promise<number> {
  const provider = parseProvider(readProviderFromArgs(args));
  const prompt = readPromptFromEnv();
  const workingDirectory = readWorkingDirectoryFromEnv();
  const modelMode = readModelModeFromEnv();
  const executionType = readExecutionTypeFromEnv();
  const childSessionId = readChildSessionIdFromEnv();
  logger.debug(`[ORCHESTRATOR ONESHOT] Starting ${provider} one-shot`);

  if (provider === 'gemini' && (process.env.HAPPY_ORCH_LEADER_PROXY_URL
    || process.env.HAPPY_ORCH_TEMPLATE_SOCKET))
    throw new Error('UNSUPPORTED_CLIENT: Gemini scoped orchestration tools unavailable');

  const taskId = process.env[ORCHESTRATOR_ENV_KEYS.taskId] ?? '';
  let isolated: ReturnType<typeof prepareIsolatedCodexHome> | undefined;
  if (provider === 'codex') {
    const taskWorkspace = loadLocalExecutionWorkspace(join(configuration.happyHomeDir, 'orchestrator-workspaces'), taskId);
    if (taskWorkspace.worktreePath !== workingDirectory)
      throw new Error('SESSION_RECOVERY_REQUIRED: task workspace changed');
    isolated = prepareIsolatedCodexHome(taskId, taskWorkspace.worktreePath, executionType === 'resume'
      ? { sessionId: childSessionId!, worktree: taskWorkspace.worktreePath } : undefined);
  }
  let claudeHome: string | undefined;
  let geminiHome: ReturnType<typeof prepareIsolatedGeminiHome> | undefined;
  if (provider === 'claude') {
    const taskWorkspace = loadLocalExecutionWorkspace(join(configuration.happyHomeDir, 'orchestrator-workspaces'), taskId);
    if (taskWorkspace.worktreePath !== workingDirectory)
      throw new Error('SESSION_RECOVERY_REQUIRED: Claude task workspace changed');
    claudeHome = prepareIsolatedClaudeHome(taskId, taskWorkspace.worktreePath,
      executionType === 'resume' ? childSessionId : undefined);
  }
  if (provider === 'gemini') {
    const taskWorkspace = loadLocalExecutionWorkspace(join(configuration.happyHomeDir, 'orchestrator-workspaces'), taskId);
    if (taskWorkspace.worktreePath !== workingDirectory)
      throw new Error('SESSION_RECOVERY_REQUIRED: Gemini task workspace changed');
    geminiHome = prepareIsolatedGeminiHome(taskId, taskWorkspace.worktreePath,
      executionType === 'resume' ? childSessionId : undefined);
  }
  try {
    if (readPermissionModeFromEnv() === 'approval') {
      if (provider !== 'codex' || !workingDirectory || !isolated
        || process.env.HAPPY_ORCH_LEADER_PROXY_URL || process.env.HAPPY_ORCH_TEMPLATE_SOCKET)
        throw new Error('Approval runner requires isolated Codex task worktree');
      const proxyUrl = process.env.HAPPY_ORCH_APPROVAL_PROXY_URL;
      const capability = process.env.HAPPY_ORCH_APPROVAL_CAPABILITY;
      if (!proxyUrl || !capability) throw new Error('Approval proxy is unavailable');
      process.env.CODEX_HOME = isolated.path;
      return await runCodexApproval({ prompt, cwd: workingDirectory, modelMode,
        resumeSessionId: executionType === 'resume' ? childSessionId : undefined,
        proxyUrl, capability });
    }
    const plan = buildSpawnPlan(provider, prompt, workingDirectory, modelMode, executionType, childSessionId, readPermissionModeFromEnv());
    if (isolated) plan.env = { ...plan.env, CODEX_HOME: isolated.path };
    if (claudeHome) plan.env = { ...plan.env, HOME: claudeHome, CLAUDE_CONFIG_DIR: claudeHome };
    if (geminiHome) {
      plan.env = { ...plan.env, HOME: geminiHome.path, GEMINI_CLI_HOME: geminiHome.path };
      delete plan.env.GEMINI_API_KEY;
      delete plan.env.GOOGLE_API_KEY;
      delete plan.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    return await spawnAndWait(plan);
  } finally { isolated?.cleanup(); geminiHome?.cleanup(); }
}
