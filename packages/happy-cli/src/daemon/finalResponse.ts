import type { OrchestratorProvider } from '@/orchestrator/common';

export type FinalResponse = { finalText: string | null; sessionId: string | null; diagnostic: string | null };
export type SafeToolEvent = { kind: 'tool' | 'result'; phase: 'started' | 'updated' | 'completed';
  operation: 'shell' | 'file_change' | 'web' | 'tool'; durationMs: number | null;
  outcome: 'success' | 'failure' | 'unknown' | null };
const MAX_RESULT_BYTES = 65_536;
const MAX_EVENT_CHARS = 1_000_000;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && Buffer.byteLength(text, 'utf8') <= MAX_RESULT_BYTES ? text : null;
}
function cleanId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,256}$/.test(value) ? value : null;
}
export function safeDiagnostic(value: string): string | null {
  const cleaned = value
    .replace(/\b(?:sk|rk|pk)-[a-zA-Z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s]+/gi, '$1[redacted]')
    .replace(/([?&](?:key|token|secret|api_key)=)[^\s&]+/gi, '$1[redacted]')
    .trim();
  return cleaned ? cleaned.slice(-2000) : null;
}

export class FinalResponseParser {
  private buffer = '';
  private finalText: string | null = null;
  private sessionId: string | null = null;
  private diagnostic: string | null = null;
  private invalid = false;
  private completed = false;
  private usage: { inputTokens: number; outputTokens: number } | null = null;
  private readonly startedItems = new Map<string, number>();
  private readonly claudeToolKinds = new Map<string, SafeToolEvent['operation']>();
  private claudeResult: any = null;
  private geminiText = '';
  private preludeLines = 0;

  constructor(private readonly provider: OrchestratorProvider,
    private readonly onToolEvent?: (event: SafeToolEvent) => void,
    private readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
    private readonly allowBoundedPrelude = false) {}

  getSessionId(): string | null { return this.sessionId; }
  getParseState(): 'invalid' | 'waiting' | 'session' { return this.invalid ? 'invalid' : this.sessionId ? 'session' : 'waiting'; }
  getUsage(): { inputTokens: number; outputTokens: number } | null { return this.usage; }

  push(chunk: string): void {
    if (this.invalid) return;
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (this.provider === 'codex') this.codexLine(line);
      else if (this.provider === 'gemini') this.geminiLine(line);
      else this.claudeLine(line);
    }
    if (this.buffer.length > MAX_EVENT_CHARS) { this.invalid = true; this.buffer = ''; }
  }

  private geminiLine(line: string): void {
    if (!line.trim()) return;
    let event: any;
    try { event = JSON.parse(line); }
    catch { this.invalid = true; return; }
    if (event?.type === 'init') this.sessionId = cleanId(event.session_id);
    if (event?.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
      this.geminiText = event.delta === true ? this.geminiText + event.content : event.content;
      if (Buffer.byteLength(this.geminiText, 'utf8') > MAX_RESULT_BYTES) this.invalid = true;
    }
    if (event?.type === 'tool_use' && typeof event.tool_id === 'string') {
      this.startedItems.set(event.tool_id, Date.now());
      this.onToolEvent?.({ kind: 'tool', phase: 'started', operation: 'tool', durationMs: null, outcome: null });
    }
    if (event?.type === 'tool_result' && typeof event.tool_id === 'string') {
      const started = this.startedItems.get(event.tool_id);
      if (started !== undefined) {
        this.startedItems.delete(event.tool_id);
        this.onToolEvent?.({ kind: 'result', phase: 'completed', operation: 'tool',
          durationMs: Math.max(0, Date.now() - started),
          outcome: event.status === 'success' ? 'success' : event.status === 'error' ? 'failure' : 'unknown' });
      }
    }
    if (event?.type === 'error') {
      this.invalid = true;
      this.diagnostic = safeDiagnostic(String(event.message ?? 'Provider failed'));
    }
    if (event?.type === 'result') {
      this.completed = event.status === 'success';
      if (!this.completed) {
        this.invalid = true;
        this.diagnostic = safeDiagnostic(String(event.error?.message ?? 'Provider failed'));
      }
    }
  }

  private claudeLine(line: string): void {
    if (!line.trim() || this.invalid) return;
    let event: any;
    try { event = JSON.parse(line); }
    catch { this.invalid = true; return; }
    if (event?.type === 'system' || event?.type === 'assistant' || event?.type === 'result')
      this.sessionId = cleanId(event.session_id) ?? this.sessionId;
    if (event?.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type !== 'tool_use' || typeof block.id !== 'string'
          || block.id.length > 256 || this.startedItems.has(block.id)) continue;
        this.startedItems.set(block.id, Date.now());
        const operation = block.name === 'Bash' ? 'shell'
          : ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(block.name) ? 'file_change'
            : ['WebFetch', 'WebSearch'].includes(block.name) ? 'web' : 'tool';
        this.onToolEvent?.({ kind: 'tool', phase: 'started', operation,
          durationMs: null, outcome: null });
        this.claudeToolKinds.set(block.id, operation);
      }
    }
    if (event?.type === 'user' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        const started = this.startedItems.get(block.tool_use_id);
        if (started === undefined) continue;
        this.startedItems.delete(block.tool_use_id);
        const operation = this.claudeToolKinds.get(block.tool_use_id) ?? 'tool';
        this.claudeToolKinds.delete(block.tool_use_id);
        this.onToolEvent?.({ kind: 'result', phase: 'completed', operation,
          durationMs: Math.max(0, Date.now() - started),
          outcome: block.is_error === true ? 'failure'
            : block.is_error === false ? 'success' : 'unknown' });
      }
    }
    if (event?.type === 'result') this.claudeResult = event;
  }

  private codexLine(line: string): void {
    if (!line.trim()) return;
    let event: any;
    try { event = JSON.parse(line); }
    catch {
      if (this.allowBoundedPrelude && !this.sessionId && this.preludeLines < 2
        && Buffer.byteLength(line, 'utf8') <= 1_024) { this.preludeLines++; return; }
      this.invalid = true; return;
    }
    if (event?.type === 'thread.started') this.sessionId = cleanId(event.thread_id);
    if (event?.type === 'item.started' || event?.type === 'item.updated' || event?.type === 'item.completed') {
      const item = event.item;
      const operation = item?.type === 'command_execution' ? 'shell'
        : item?.type === 'file_change' ? 'file_change'
          : item?.type === 'web_search' ? 'web'
            : item?.type === 'mcp_tool_call' ? 'tool' : null;
      if (operation && this.onToolEvent) {
        const phase = event.type === 'item.started' ? 'started' : event.type === 'item.updated' ? 'updated' : 'completed';
        const id = typeof item.id === 'string' && item.id.length <= 256 ? item.id : null;
        if (id && phase === 'started') this.startedItems.set(id, Date.now());
        const start = id ? this.startedItems.get(id) : undefined;
        const durationMs = phase === 'completed' && start !== undefined ? Math.max(0, Date.now() - start) : null;
        if (id && phase === 'completed') this.startedItems.delete(id);
        const outcome = phase !== 'completed' ? null : item.status === 'completed' || item.exit_code === 0
          ? 'success' : item.status === 'failed' || (Number.isInteger(item.exit_code) && item.exit_code !== 0)
            ? 'failure' : 'unknown';
        this.onToolEvent({ kind: phase === 'completed' ? 'result' : 'tool', phase, operation, durationMs, outcome });
      }
    }
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message') {
      this.finalText = cleanText(event.item.text);
      if (!this.finalText) this.invalid = true;
    }
    if (event?.type === 'turn.completed') {
      this.completed = true;
      const input = event.usage?.input_tokens;
      const output = event.usage?.output_tokens;
      if (Number.isSafeInteger(input) && input >= 0 && input <= 1_000_000_000
        && Number.isSafeInteger(output) && output >= 0 && output <= 1_000_000_000) {
        this.usage = { inputTokens: input, outputTokens: output };
        this.onUsage?.(this.usage);
      }
    }
    if (event?.type === 'turn.failed' || event?.type === 'error') {
      this.invalid = true;
      this.diagnostic = safeDiagnostic(String(event.error?.message ?? event.message ?? 'Provider failed'));
    }
  }

  finish(): FinalResponse {
    if (this.provider === 'gemini') {
      if (this.buffer.trim()) this.geminiLine(this.buffer);
      this.buffer = '';
      return { finalText: this.invalid || !this.completed || this.startedItems.size
        ? null : cleanText(this.geminiText), sessionId: this.sessionId, diagnostic: this.diagnostic };
    }
    if (this.provider === 'codex') {
      if (this.buffer.trim()) this.codexLine(this.buffer);
      this.buffer = '';
      return { finalText: this.invalid || !this.completed ? null : this.finalText, sessionId: this.sessionId, diagnostic: this.diagnostic };
    }
    let result: any;
    try { result = this.provider === 'claude' && this.claudeResult
      ? this.claudeResult : JSON.parse(this.buffer); }
    catch { return { finalText: null, sessionId: null, diagnostic: 'Provider did not return valid JSON' }; }
    if (this.provider === 'claude') {
      if (this.buffer.trim() && this.claudeResult) this.claudeLine(this.buffer);
      if (this.invalid || (this.claudeResult && this.startedItems.size))
        return { finalText: null, sessionId: this.sessionId, diagnostic: 'Claude stream did not complete cleanly' };
      const input = result?.usage?.input_tokens;
      const output = result?.usage?.output_tokens;
      if (!result?.is_error && Number.isSafeInteger(input) && input >= 0 && input <= 1_000_000_000
        && Number.isSafeInteger(output) && output >= 0 && output <= 1_000_000_000) {
        this.usage = { inputTokens: input, outputTokens: output };
        this.onUsage?.(this.usage);
      }
      return { finalText: result?.is_error ? null : cleanText(result?.result), sessionId: cleanId(result?.session_id) ?? this.sessionId,
        diagnostic: result?.is_error ? safeDiagnostic(String(result?.result ?? 'Provider failed')) : null };
    }
    return { finalText: result?.error ? null : cleanText(result?.response), sessionId: cleanId(result?.session_id),
      diagnostic: result?.error ? safeDiagnostic(String(result.error?.message ?? result.error)) : null };
  }
}
