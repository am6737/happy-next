import { describe, expect, it } from 'vitest';
import { FinalResponseParser, safeDiagnostic } from './finalResponse';

describe('structured final response', () => {
  it('keeps only Codex final agent message and session id', () => {
    const parser = new FinalResponseParser('codex');
    parser.push('{"type":"thread.started","thread_id":"12345678-1234"}\n{"type":"item.completed","item":{"type":"command_execution","command":"cat secret"}}\n');
    parser.push('{"type":"item.completed","item":{"type":"agent_message","text":"The answer is 42."}}\n{"type":"turn.completed","usage":{"total_tokens":900}}\n');
    expect(parser.finish()).toEqual({ finalText: 'The answer is 42.', sessionId: '12345678-1234', diagnostic: null });
  });
  it('fails closed on non-JSON stdout or absent final message', () => {
    const parser = new FinalResponseParser('codex');
    parser.push('You are the internal prompt\ntokens used 100\n');
    parser.push('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n');
    expect(parser.finish().finalText).toBeNull();
    expect(new FinalResponseParser('codex').finish().finalText).toBeNull();
    const incomplete = new FinalResponseParser('codex');
    incomplete.push('{"type":"item.completed","item":{"type":"agent_message","text":"premature"}}\n');
    expect(incomplete.finish().finalText).toBeNull();
    const huge = new FinalResponseParser('codex');
    huge.push('x'.repeat(1_000_001));
    huge.push('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n{"type":"turn.completed"}\n');
    expect(huge.finish().finalText).toBeNull();
  });
  it('accepts a bounded local wrapper prelude only in approval mode', () => {
    const parser = new FinalResponseParser('codex', undefined, undefined, true);
    parser.push('local wrapper startup\n{"type":"thread.started","thread_id":"12345678-1234"}\n');
    parser.push('{"type":"item.completed","item":{"type":"agent_message","text":"Approved result"}}\n{"type":"turn.completed"}\n');
    expect(parser.finish()).toEqual({ finalText: 'Approved result', sessionId: '12345678-1234', diagnostic: null });
    const excessive = new FinalResponseParser('codex', undefined, undefined, true);
    excessive.push('one\ntwo\nthree\n{"type":"thread.started","thread_id":"12345678-1234"}\n');
    expect(excessive.finish().finalText).toBeNull();
  });
  it('selects only final provider text for Claude and streamed Gemini', () => {
    const claude = new FinalResponseParser('claude');
    claude.push('{"result":"Final answer","session_id":"session-1234","usage":{"input_tokens":99},"prompt":"internal"}');
    expect(claude.finish().finalText).toBe('Final answer');
    const gemini = new FinalResponseParser('gemini');
    gemini.push('{"type":"init","session_id":"session-5678"}\n');
    gemini.push('{"type":"message","role":"assistant","content":"Gemini answer","delta":true,"thoughts":"internal"}\n');
    gemini.push('{"type":"result","status":"success"}\n');
    expect(gemini.finish().finalText).toBe('Gemini answer');
  });
  it('redacts credentials from diagnostics', () => {
    expect(safeDiagnostic('Authorization: Bearer secret123 sk-example123456789')).toBe('Authorization: Bearer [redacted] [redacted]');
  });
  it('rejects oversized UTF-8 final text and failed provider envelopes', () => {
    const codex = new FinalResponseParser('codex');
    codex.push(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '中'.repeat(22_000) } }) + '\n{"type":"turn.completed"}\n');
    expect(codex.finish().finalText).toBeNull();
    const claude = new FinalResponseParser('claude');
    claude.push('{"is_error":true,"result":"partial result"}');
    expect(claude.finish().finalText).toBeNull();
    const gemini = new FinalResponseParser('gemini');
    gemini.push('{"type":"message","role":"assistant","content":"partial result","delta":true}\n');
    gemini.push('{"type":"result","status":"error","error":{"message":"failed"}}\n');
    expect(gemini.finish().finalText).toBeNull();
  });
  it('keeps Gemini tool payload private and rejects unfinished tool calls', () => {
    const events: Array<Parameters<NonNullable<ConstructorParameters<typeof FinalResponseParser>[1]>>[0]> = [];
    const parser = new FinalResponseParser('gemini', (event) => events.push(event));
    parser.push(JSON.stringify({ type: 'tool_use', tool_id: 'tool-1', tool_name: 'run_shell_command',
      parameters: { command: 'private command' } }) + '\n');
    parser.push(JSON.stringify({ type: 'tool_result', tool_id: 'tool-1', status: 'success',
      output: 'private output' }) + '\n');
    parser.push('{"type":"message","role":"assistant","content":"Done","delta":true}\n');
    parser.push('{"type":"result","status":"success"}\n');
    expect(parser.finish().finalText).toBe('Done');
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain('private');
    const unfinished = new FinalResponseParser('gemini');
    unfinished.push('{"type":"tool_use","tool_id":"tool-2"}\n');
    unfinished.push('{"type":"message","role":"assistant","content":"unsafe"}\n');
    unfinished.push('{"type":"result","status":"success"}\n');
    expect(unfinished.finish().finalText).toBeNull();
  });
  it('records only measured Codex turn usage', () => {
    const parser = new FinalResponseParser('codex');
    parser.push('{"type":"turn.completed","usage":{"input_tokens":25,"output_tokens":7}}\n');
    expect(parser.getUsage()).toEqual({ inputTokens: 25, outputTokens: 7 });
    const invalid = new FinalResponseParser('codex');
    invalid.push('{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":7}}\n');
    expect(invalid.getUsage()).toBeNull();
  });
  it('records bounded Claude final usage once and ignores failed envelopes', () => {
    const usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    const parser = new FinalResponseParser('claude', undefined, (delta) => usage.push(delta));
    parser.push('{"result":"done","session_id":"session-1234","usage":{"input_tokens":25,"output_tokens":7}}');
    expect(parser.finish().finalText).toBe('done');
    expect(usage).toEqual([{ inputTokens: 25, outputTokens: 7 }]);
    const failed = new FinalResponseParser('claude', undefined, (delta) => usage.push(delta));
    failed.push('{"is_error":true,"result":"failed","usage":{"input_tokens":999,"output_tokens":999}}');
    expect(failed.finish().finalText).toBeNull();
    expect(usage).toHaveLength(1);
  });
  it('emits only classified Claude stream tool metadata and final result', () => {
    const events: Array<Parameters<NonNullable<ConstructorParameters<typeof FinalResponseParser>[1]>>[0]> = [];
    const usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    const parser = new FinalResponseParser('claude', (event) => events.push(event),
      (delta) => usage.push(delta));
    const secret = 'private-command-path-and-token';
    parser.push(JSON.stringify({ type: 'system', session_id: 'session-1234', apiKeySource: secret }) + '\n');
    parser.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use',
      id: 'tool-1', name: 'Write', input: { file_path: `/secret/${secret}`, content: secret } }] } }) + '\n');
    parser.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result',
      tool_use_id: 'tool-1', is_error: false, content: secret }] } }) + '\n');
    parser.push(JSON.stringify({ type: 'result', session_id: 'session-1234', result: 'Done',
      usage: { input_tokens: 5, output_tokens: 2 }, prompt: secret }) + '\n');
    expect(parser.finish()).toEqual({ finalText: 'Done', sessionId: 'session-1234', diagnostic: null });
    expect(events).toEqual([
      { kind: 'tool', phase: 'started', operation: 'file_change', durationMs: null, outcome: null },
      { kind: 'result', phase: 'completed', operation: 'file_change',
        durationMs: expect.any(Number), outcome: 'success' },
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(usage).toEqual([{ inputTokens: 5, outputTokens: 2 }]);
    const incomplete = new FinalResponseParser('claude');
    incomplete.push('{"type":"assistant","message":{"content":[{"type":"tool_use","id":"unfinished","name":"Write"}]}}\n');
    incomplete.push('{"type":"result","result":"unsafe"}\n');
    expect(incomplete.finish().finalText).toBeNull();
  });
  it('emits only bounded operation metadata from hostile tool payloads', () => {
    const events: Array<Parameters<NonNullable<ConstructorParameters<typeof FinalResponseParser>[1]>>[0]> = [];
    const parser = new FinalResponseParser('codex', (event) => events.push(event));
    const secret = 'private-command-and-path-marker';
    parser.push(JSON.stringify({ type: 'item.started', item: { id: 'call-1', type: 'command_execution',
      command: `cat /private/${secret}`, stdout: secret, stderr: secret } }) + '\n');
    parser.push(JSON.stringify({ type: 'item.completed', item: { id: 'call-1', type: 'command_execution',
      command: secret, output: secret, exit_code: 7, status: 'failed' } }) + '\n');
    expect(events).toEqual([
      { kind: 'tool', phase: 'started', operation: 'shell', durationMs: null, outcome: null },
      { kind: 'result', phase: 'completed', operation: 'shell', durationMs: expect.any(Number), outcome: 'failure' },
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
  });
  it('counts each completed Codex turn once across streamed chunks', () => {
    const usage: Array<{ inputTokens: number; outputTokens: number }> = [];
    const parser = new FinalResponseParser('codex', undefined, (delta) => usage.push(delta));
    parser.push('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}\n{"type":"turn.com');
    parser.push('pleted","usage":{"input_tokens":12,"output_tokens":3}}\n');
    expect(usage).toEqual([{ inputTokens: 10, outputTokens: 2 }, { inputTokens: 12, outputTokens: 3 }]);
    parser.finish();
    expect(usage).toHaveLength(2);
  });
});
