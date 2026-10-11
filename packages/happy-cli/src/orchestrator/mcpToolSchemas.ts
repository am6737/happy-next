import { z } from 'zod';

const orchestratorTargetTypeSchema = z.preprocess(
  (value) => value === 'machine' ? 'machine_id' : value,
  z.enum(['current_machine', 'machine_id']),
).describe('"current_machine" or "machine_id"; alias "machine" normalizes to "machine_id".');

const orchestratorTaskSchema = z.object({
  taskKey: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(256).optional(),
  provider: z.enum(['claude', 'codex', 'gemini', 'qoder', 'shell'])
    .describe('AI agent provider to execute the task, or "shell" to run `prompt` as a shell command on the target machine (no AI; exit code 0 = completed).'),
  model: z.string().min(1).max(128).optional()
    .describe('Model mode for this provider; prefer orchestrator_get_context.data.modelModes[provider]. Use "default" for CLI default. Codex only: append "-fast" (e.g. "gpt-5.5-high-fast") to run in fast mode, which uses more quota — off unless the user asks for it.'),
  prompt: z.string().min(1).max(65536),
  workingDirectory: z.string().max(512).optional()
    .describe('Absolute path for task execution. Defaults to the controller session working directory from get_context.'),
  timeoutMs: z.number().int().min(1000).max(2 ** 31 - 1).optional()
    .describe('Stop the task after this long. AI tasks: at most 24h, the default. Shell tasks: no timeout when omitted.'),
  dependsOn: z.array(z.string().min(1).max(128)).max(31).optional()
    .describe('Prerequisite taskKeys, not taskIds. Ordering only; no output/context is passed.'),
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(10).optional()
      .describe('Maximum attempts for this task (including first run).'),
    backoffMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional()
      .describe('Retry backoff delay in milliseconds before the next attempt.'),
  }).optional(),
  target: z.object({
    type: orchestratorTargetTypeSchema,
    machineId: z.string().optional()
      .describe('Required when target.type is "machine_id" (or alias "machine").'),
  }).optional().describe('Optional dispatch routing target.'),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA = {
  description: 'Get available AI providers, models, and session context before creating a dispatch.',
  title: 'Orchestrator Get Context',
  inputSchema: {},
} as const;

export const ORCHESTRATOR_SUBMIT_TOOL_SCHEMA = {
  description: 'Delegate one or more self-contained prompts to AI child tasks across claude/codex/gemini/qoder, in parallel or with dependsOn. Returns immediately; wait for <orchestrator-callback> before calling orchestrator_pend.',
  title: 'Orchestrator Submit',
  inputSchema: {
    title: z.string().min(1).max(256).describe('Run title'),
    tasks: z.array(orchestratorTaskSchema).min(1).max(32),
    maxConcurrency: z.number().int().min(1).max(8).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    controllerSessionId: z.string().optional().describe('Optional controller session ID. Defaults to current MCP session when omitted.'),
  },
} as const;

export const MACHINE_EXEC_TOOL_SCHEMA = {
  description: 'Run a shell command directly (no AI) on one or more online machines of this account and get each one\'s exitCode, stdout and stderr. Waits up to waitMs; a command still running then keeps running, and its result arrives as <orchestrator-callback> (fetch it with orchestrator_pend). Non-zero exit = failed. No stdin: interactive commands fail. Ask the user before destructive commands.',
  title: 'Machine Exec',
  inputSchema: {
    command: z.string().min(1).max(65536)
      .describe('Runs as `$SHELL -lc <command>` (PowerShell -Command on Windows): see get_context machines[].shell and platform.'),
    machineIds: z.array(z.string().min(1).max(128)).min(1).max(32).optional()
      .describe('Target machineIds from orchestrator_get_context (with shellReady: true). Omit with allOnline.'),
    allOnline: z.boolean().optional()
      .describe('true: run on every online machine with shellReady instead of machineIds.'),
    cwd: z.string().max(512).optional()
      .describe('Working directory on each target; "~" expands. Defaults to the home directory.'),
    timeoutMs: z.number().int().min(1000).max(2 ** 31 - 1).optional()
      .describe('Kill the command (and everything it started) after this long. Omit for no timeout.'),
    waitMs: z.number().int().min(0).max(50_000).optional()
      .describe('How long this call waits for the result. Default 30000; 0 returns the runId at once.'),
    maxConcurrency: z.number().int().min(1).max(32).optional()
      .describe('Machines running the command at once. Default: all.'),
    title: z.string().min(1).max(256).optional(),
  },
} as const;

export const ORCHESTRATOR_PEND_TOOL_SCHEMA = {
  description: 'Fetch dispatch status/results. Do not poll after submit; wait for <orchestrator-callback>, then call once with include="all_tasks" and timeoutMs=0. Call earlier only on resume, missing callback, or user-requested progress.',
  title: 'Orchestrator Pend',
  inputSchema: {
    runId: z.string().describe('Run ID'),
    cursor: z.string().optional(),
    waitFor: z.enum(['change', 'terminal']).optional(),
    timeoutMs: z.number().int().min(0).max(3_600_000).optional()
      .describe('Total wait timeout in ms. Defaults to 10 minutes when omitted.'),
    include: z.enum(['summary', 'all_tasks']).optional()
      .describe('"summary" returns run-level status only; "all_tasks" includes per-task details.'),
    taskId: z.string().optional()
      .describe('Return only this task, with its full shell output (results with several shell tasks keep the last 4000 characters of each one\'s output).'),
  },
} as const;

export const ORCHESTRATOR_LIST_TOOL_SCHEMA = {
  description: 'List all dispatches and their current status (active, completed, failed).',
  title: 'Orchestrator List',
  inputSchema: {
    status: z.enum(['active', 'terminal', 'queued', 'running', 'canceling', 'completed', 'failed', 'cancelled']).optional()
      .describe('Filter by status. "active" = queued|running|canceling; "terminal" = completed|failed|cancelled.'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional(),
  },
} as const;

export const ORCHESTRATOR_CANCEL_TOOL_SCHEMA = {
  description: 'Cancel a dispatch that is queued or in progress.',
  title: 'Orchestrator Cancel',
  inputSchema: {
    runId: z.string().describe('Run ID'),
    reason: z.string().max(512).optional(),
  },
} as const;

export const ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA = {
  description: 'Resume an existing child task session by sending a follow-up to a completed/failed task. Requires a captured childSessionId, requeues the task, and returns immediately; wait for <orchestrator-callback>.',
  title: 'Orchestrator Send Message',
  inputSchema: {
    taskId: z.string().describe('Completed/failed task ID to resume; use taskId, not taskKey.'),
    message: z.string().min(1).max(65_536).describe('Message to send to the existing child session'),
    controllerSessionId: z.string().optional().describe('Optional session to report back to. Defaults to current MCP session when omitted.'),
  },
} as const;
