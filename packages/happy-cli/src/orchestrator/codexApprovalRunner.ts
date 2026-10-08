import { CodexAppServerBackend } from '@/codex/appserver/CodexAppServerBackend';
import { codexPackage } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';
import { isModelModeForAgent, MODEL_MODE_DEFAULT, parseCodexModelMode } from 'happy-wire';
import { normalizeApprovalAction, type ApprovalAction } from './approvalAction';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';

type Options = { prompt: string; cwd: string; modelMode?: string; resumeSessionId?: string;
  proxyUrl: string; capability: string };
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

export async function runCodexApproval(options: Options): Promise<number> {
  if (!options.proxyUrl.startsWith('http://127.0.0.1:') || !/^[0-9a-f]{64}$/.test(options.capability))
    throw new Error('Approval proxy is unavailable');
  const runtime = resolveCodexRuntime(codexPackage(), ['app-server']);
  const providerEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  for (const key of Object.keys(providerEnv)) if (key.startsWith('HAPPY_ORCH_')) delete providerEnv[key];
  let model: string | null = null;
  let reasoningEffort: string | null = null;
  if (options.modelMode && options.modelMode !== MODEL_MODE_DEFAULT) {
    if (isModelModeForAgent('codex', options.modelMode)) {
      const parsed = parseCodexModelMode(options.modelMode);
      model = parsed.family === MODEL_MODE_DEFAULT ? null : parsed.family;
      reasoningEffort = parsed.effort ?? null;
    } else model = options.modelMode;
  }
  let sessionId: string | null = null;
  let finalText: string | null = null;
  let usage: { input_tokens: number; output_tokens: number } | null = null;
  const approvedCalls = new Map<string, ApprovalAction>();
  const resultReports: Promise<void>[] = [];
  let reportFailed = false;
  let approvalDenied = false;
  const abort = new AbortController();
  const onStop = () => abort.abort();
  process.once('SIGTERM', onStop);
  process.once('SIGINT', onStop);
  const backend = new CodexAppServerBackend({ cwd: options.cwd,
    command: runtime.command, args: runtime.args, env: providerEnv,
    model, reasoningEffort, approvalPolicy: 'untrusted', sandbox: 'read-only',
    resumeThreadId: options.resumeSessionId ?? null, signal: abort.signal,
    mcpServers: {},
    permissionHandler: { handleToolCall: async (callId, toolName, args) => {
      if (!sessionId || abort.signal.aborted) { approvalDenied = true; return { decision: 'denied' }; }
      const action = normalizeApprovalAction(sessionId, callId, toolName, args, options.cwd);
      if (!action) {
        approvalDenied = true;
        const command = Array.isArray(args.command) && args.command.length === 1 ? args.command[0] : args.command;
        let cwdMatchesTask = false;
        try { cwdMatchesTask = typeof args.cwd === 'string' && realpathSync(args.cwd) === realpathSync(options.cwd); }
        catch { /* Diagnostic only. */ }
        process.stderr.write(`APPROVAL_ACTION_UNREVIEWABLE ${JSON.stringify({
          tool: toolName === 'CodexBash' ? 'shell' : toolName === 'CodexPatch' ? 'file_change' : 'other',
          hasCwd: typeof args.cwd === 'string', hasStartedCwd: typeof args.startedCwd === 'string',
          cwdMatchesStarted: args.cwd === args.startedCwd,
          hasStartedCommand: typeof args.startedCommand === 'string',
          commandMatchesStarted: args.command === args.startedCommand
            || Array.isArray(args.command) && args.command.length === 1 && args.command[0] === args.startedCommand,
          cwdMatchesTask, commandBytes: typeof command === 'string' ? Buffer.byteLength(command) : null,
          commandHasControl: typeof command === 'string' && /[\x00-\x1f\x7f]/.test(command),
          commandHasSensitiveWord: typeof command === 'string' && /(?:authorization|bearer|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i.test(command),
          commandHasAbsolutePath: typeof command === 'string' && /(?:^|[\s'"=])(?:\/|~\/|\.\.\/)/.test(command),
          commandIncludesTaskCwd: typeof command === 'string' && command.includes(options.cwd),
          absoluteBasenames: typeof command === 'string'
            ? [...command.matchAll(/(?:^|[\s'"=])(\/[^\s'"=;|&]+)/g)].slice(0, 4)
              .map((match) => basename(match[1]).slice(0, 24)) : [],
          network: args.kind === 'network', grantRoot: Boolean(args.grantRoot),
          extraPermissions: Boolean(args.additionalPermissions),
        })}\n`);
        return { decision: 'denied' };
      }
      try {
        const response = await fetch(options.proxyUrl, { method: 'POST', signal: abort.signal,
          headers: { authorization: `Bearer ${options.capability}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'request', childSessionId: sessionId, ...action }) });
        const result = await response.json() as { approved?: boolean };
        if (!response.ok || result.approved !== true) {
          process.stderr.write(`APPROVAL_PROXY_DENIED HTTP_${response.status}\n`);
          approvalDenied = true; return { decision: 'denied' };
        }
        const current = normalizeApprovalAction(sessionId, callId, toolName, args, options.cwd);
        if (!current || current.actionHash !== action.actionHash) {
          approvalDenied = true;
          process.stderr.write('APPROVAL_ACTION_CHANGED_BEFORE_RELEASE\n');
          return { decision: 'denied' };
        }
        approvedCalls.set(callId, action);
        return { decision: 'approved' };
      } catch { process.stderr.write('APPROVAL_PROXY_REQUEST_FAILED\n'); approvalDenied = true; return { decision: 'denied' }; }
    } },
  });
  backend.onMessage((message) => {
    if (message.type === 'tool-call' && typeof message.callId === 'string'
      && message.callId.length <= 256 && message.toolName === 'CodexBash')
      emit({ type: 'item.started', item: { id: message.callId, type: 'command_execution' } });
    if (message.type === 'tool-result' && typeof message.callId === 'string'
      && message.callId.length <= 256 && message.toolName === 'CodexBash')
      emit({ type: 'item.completed', item: { id: message.callId, type: 'command_execution', status: 'unknown' } });
    if (message.type === 'patch-apply-begin' && typeof message.call_id === 'string'
      && message.call_id.length <= 256)
      emit({ type: 'item.started', item: { id: message.call_id, type: 'file_change' } });
    if (message.type === 'patch-apply-end' && typeof message.call_id === 'string'
      && message.call_id.length <= 256)
      emit({ type: 'item.completed', item: { id: message.call_id, type: 'file_change',
        status: message.success ? 'completed' : 'failed' } });
    if (message.type === 'model-output' && typeof message.fullText === 'string') finalText = message.fullText;
    if (message.type === 'token-count') {
      const last = message.last_token_usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
      if (Number.isSafeInteger(last?.input_tokens) && Number.isSafeInteger(last?.output_tokens))
        usage = { input_tokens: last!.input_tokens as number, output_tokens: last!.output_tokens as number };
    }
    const callId = message.type === 'tool-result' ? message.callId
      : message.type === 'patch-apply-end' ? message.call_id : null;
    if (callId && approvedCalls.has(callId)) {
      const action = approvedCalls.get(callId)!;
      approvedCalls.delete(callId);
      resultReports.push(fetch(options.proxyUrl, { method: 'POST', signal: abort.signal,
        headers: { authorization: `Bearer ${options.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'result', operationId: action.operationId,
          actionHash: action.actionHash }) }).then((response) => {
        if (!response.ok) throw new Error('Approval result journal unavailable');
      }).catch(() => { reportFailed = true; }));
    }
  });
  try {
    const started = await backend.startSession();
    sessionId = started.sessionId;
    emit({ type: 'thread.started', thread_id: sessionId });
    await backend.sendPrompt(sessionId, options.prompt);
    await backend.waitForResponseComplete();
    await Promise.all(resultReports);
    if (approvalDenied || reportFailed || approvedCalls.size || !finalText || Buffer.byteLength(finalText, 'utf8') > 65_536)
      throw new Error('Approval execution did not produce a durable final response');
    emit({ type: 'item.completed', item: { type: 'agent_message', text: finalText } });
    emit({ type: 'turn.completed', ...(usage ? { usage } : {}) });
    return 0;
  } finally {
    process.off('SIGTERM', onStop);
    process.off('SIGINT', onStop);
    await backend.dispose();
  }
}
