import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Teammate, TeammateThreadKind } from 'happy-wire';
import { dailyLogDate } from './dailyLogDate';

export interface TeammateThreadContext {
    kind: TeammateThreadKind;
    channelTitle?: string;
    channelBrief?: string;
    taskTitle?: string;
    taskUrl?: string;
    extra?: unknown;
}

export interface TeammateSystemPromptOptions {
    dir: string;
    teammate: Teammate;
    threadKind: TeammateThreadKind;
    threadContext: TeammateThreadContext;
    now?: Date;
    threadSummary?: string | null;
    archivedTopics?: boolean;
}

const MAX_FILE_CHARS = 20_000;
export const GROUP_BRIEF_PREAMBLE = 'Written by the owner for everyone in this group: what it is for, who does what, and its conventions. Follow it when you reply here.';
const TRUNCATION_MARKER = '…[truncated]';

export function teammateMemoryFiles(threadKind: TeammateThreadKind): string[] {
    return threadKind === 'group' ? ['USER.md'] : ['USER.md', 'MEMORY.md'];
}

/** Compose controller context without loading private long-term memory in groups. */
export async function buildTeammateSystemPrompt({
    dir, teammate, threadKind, threadContext, now = new Date(), threadSummary, archivedTopics,
}: TeammateSystemPromptOptions): Promise<string> {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const files = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', ...teammateMemoryFiles(threadKind)];
    if (threadKind === 'heartbeat') files.push('HEARTBEAT.md');
    files.push(`memory/${dailyLogDate(now)}.md`, `memory/${dailyLogDate(yesterday)}.md`);

    const sections: string[] = [];
    for (const file of files) {
        let content: string;
        try {
            content = await readFile(join(dir, file), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
        }
        if (content.length > MAX_FILE_CHARS) {
            content = content.slice(0, MAX_FILE_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
        }
        sections.push(`## ${file}\n\n${content}`);
    }

    if (threadContext.channelBrief) sections.push(`## Group brief\n\n${GROUP_BRIEF_PREAMBLE}\n\n${threadContext.channelBrief}`);

    if (threadKind === 'dm' || threadKind === 'group' || threadKind === 'task') {
        if (threadSummary) sections.push(`## Thread summary\n\nWritten by the daemon from earlier segments of this conversation. It is a digest, not the record: use chat_history(query) for details.\n\n${threadSummary}`);
        else if (archivedTopics && (threadKind === 'dm' || threadKind === 'group')) sections.push('## Thread summary\n\nEarlier topics in this thread are archived. Search them with chat_history(query) when the owner refers to them.');
    }

    const context = [`Teammate: ${teammate.name}`, `Kind: ${threadKind}`];
    if (threadContext.channelTitle) context.push(`Channel: ${threadContext.channelTitle}`);
    if (threadContext.taskTitle) context.push(`Task: ${threadContext.taskTitle}`);
    if (threadContext.taskUrl) context.push(`Task URL: ${threadContext.taskUrl}`);
    if (threadContext.extra !== undefined) {
        context.push(`Extra: ${typeof threadContext.extra === 'string' ? threadContext.extra : JSON.stringify(threadContext.extra, null, 2)}`);
    }
    sections.push(`## Current thread\n\n${context.join('\n')}`);
    return sections.join('\n\n');
}
