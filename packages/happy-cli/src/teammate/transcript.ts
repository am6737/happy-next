import { decodeBase64, decrypt } from '@/api/encryption';

type WorkerMessage = { seq: number; content: { t: 'encrypted'; c: string } };
type WorkerEntry = { role: string; text: string } | { role: string; tool: string; input: unknown };

/** Decode text and tool starts from the raw formats understood by the app, oldest first. */
function decodeWorkerEntries(messages: WorkerMessage[], key: Uint8Array): WorkerEntry[] {
    const entries: WorkerEntry[] = [];
    const blocks = (content: unknown, role: string) => {
        if (typeof content === 'string') { entries.push({ role, text: content }); return; }
        for (const block of Array.isArray(content) ? content : [content]) {
            if ((block?.type === 'text' || (role === 'user' && block?.type === 'mixed')) && typeof block.text === 'string') entries.push({ role, text: block.text });
            if (['tool_use', 'tool-call'].includes(block?.type) && typeof block.name === 'string') entries.push({ role, tool: block.name, input: block.input ?? {} });
        }
    };
    for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
        let record: any;
        try { record = decrypt(key, 'dataKey', decodeBase64(message.content.c)); }
        catch { continue; }
        if (!['user', 'agent', 'session'].includes(record?.role)) continue;
        if (record?.role === 'user') { blocks(record.content, 'user'); continue; }
        const content = record?.content;
        if (content?.type === 'output') {
            const data = content.data;
            if (data?.type === 'assistant' || data?.type === 'user') blocks(data.message?.content, data.type);
        }
        if (['codex', 'acp', 'gemini'].includes(content?.type)) {
            const data = content.data;
            if (data?.type === 'message' && typeof data.message === 'string') blocks(data.message, 'assistant');
            if (data?.type === 'tool-call') blocks(data, 'assistant');
            if (data?.type === 'file-edit') blocks({ type: 'tool-call', name: 'file-edit', input: { filePath: data.filePath, description: data.description } }, 'assistant');
        }
        if (content?.type === 'session') {
            const data = content.data;
            if (data?.ev?.t === 'text') blocks(data.ev.text, data.role === 'user' ? 'user' : 'assistant');
            if (data?.ev?.t === 'tool-call-start') blocks({ type: 'tool-call', name: data.ev.name, input: data.ev.args }, 'assistant');
        }
    }
    return entries;
}

/** Render only text and tool starts; assistant blocks and the whole transcript are capped. */
export function renderWorkerTranscript(messages: WorkerMessage[], key: Uint8Array): string {
    const lines = decodeWorkerEntries(messages, key).map(entry => 'tool' in entry
        ? `[tool] ${entry.tool}: ${JSON.stringify(entry.input).slice(0, 300)}`
        : `${entry.role}: ${entry.role === 'user' ? entry.text : entry.text.slice(0, 2000)}`);
    while (lines.length > 1 && lines.join('\n').length > 20000) lines.shift();
    return lines.join('\n').slice(-20000);
}

/** The worker's last assistant text, uncapped, or null if it has not replied since the last prompt. */
export function lastWorkerReply(messages: WorkerMessage[], key: Uint8Array): string | null {
    const last = decodeWorkerEntries(messages, key).filter(entry => 'text' in entry).pop();
    return last && last.role === 'assistant' && 'text' in last ? last.text : null;
}
