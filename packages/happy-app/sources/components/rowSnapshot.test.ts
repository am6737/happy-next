import { describe, expect, it } from 'vitest';
import { newestRowSnapshot, rowSnapshot, toolSnapshot, ToolHeadline } from './rowSnapshot';
import { Message, ToolCall } from '@/sync/typesMessage';

function tool(name: string, input: unknown, overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        name,
        state: 'running',
        input,
        createdAt: 0,
        startedAt: 0,
        completedAt: null,
        description: null,
        ...overrides,
    };
}

function toolCall(name: string, input: unknown, overrides: Partial<ToolCall> = {}): Message {
    return { kind: 'tool-call', id: 't1', localId: null, createdAt: 0, tool: tool(name, input, overrides), children: [] };
}

/** A title the registry read out of the call — it says what the step is on its own. */
function named(text: string): ToolHeadline {
    return { text, generic: false };
}

/** A title that is only the registry's name for the tool. */
function generic(text: string): ToolHeadline {
    return { text, generic: true };
}

describe('newestRowSnapshot', () => {
    const headlineOf = (call: ToolCall) => named(String((call.input as { file_path: string }).file_path));
    /** A step the registry can read a name out of. */
    const step = (id: string): Message => ({ ...toolCall('Read', { file_path: `/app/${id}.tsx` }), id });
    /** A row with nothing to say: a notice, not a step. */
    const notice = (id: string): Message => ({ kind: 'agent-event', id, createdAt: 0, event: { type: 'ready' } });
    const rows = (...messages: Message[]) => new Map(messages.map((m) => [m.id, m]));

    it('names the newest hidden step', () => {
        expect(newestRowSnapshot({
            hiddenIds: ['t1', 't2'],
            lineRow: step('line'),
            messageById: rows(step('t1'), step('t2'), step('line')),
            headlineOf,
        })).toBe('/app/t2.tsx');
    });

    it('steps over a hidden row that has nothing to say', () => {
        expect(newestRowSnapshot({
            hiddenIds: ['t1', 'e1'],
            lineRow: step('line'),
            messageById: rows(step('t1'), notice('e1'), step('line')),
            headlineOf,
        })).toBe('/app/t1.tsx');
    });

    it('names the row the line is drawn on when that is the only thing hidden', () => {
        // The turn's first step is the row the line stands on, and the one the reader is watching: with
        // the line's own row left out of its candidates, the line said nothing at all.
        expect(newestRowSnapshot({
            hiddenIds: [],
            lineRow: step('line'),
            messageById: rows(step('line')),
            headlineOf,
        })).toBe('/app/line.tsx');
    });

    it('prefers a step hidden below the line over the row it is drawn on', () => {
        expect(newestRowSnapshot({
            hiddenIds: ['t1'],
            lineRow: step('line'),
            messageById: rows(step('t1'), step('line')),
            headlineOf,
        })).toBe('/app/t1.tsx');
    });

    it('stays blank when nothing it hides has anything to say', () => {
        expect(newestRowSnapshot({
            hiddenIds: ['e1'],
            lineRow: null,
            messageById: rows(notice('e1')),
            headlineOf,
        })).toBeUndefined();
    });
});

describe('rowSnapshot', () => {
    it('names a step the way its own row is named', () => {
        expect(rowSnapshot(toolCall('Read', { file_path: '/app/LoginButton.tsx' }), named('/app/LoginButton.tsx')))
            .toBe('/app/LoginButton.tsx');
        expect(rowSnapshot(toolCall('Bash', { command: 'yarn deploy' }), named('Deploy to staging')))
            .toBe('Deploy to staging');
    });

    it('lets the call name itself when the title is only the name of the tool', () => {
        // "Terminal" is the tool's name, not a headline: the command names the step better.
        expect(rowSnapshot(toolCall('Bash', { command: 'yarn deploy --env staging' }), generic('Terminal')))
            .toBe('yarn deploy --env staging');
        expect(rowSnapshot(toolCall('view_image', { path: '/tmp/shot.png' }), generic('View Image')))
            .toBe('/tmp/shot.png');
        // A command is several lines; the first says what it is.
        expect(rowSnapshot(toolCall('Bash', { command: 'yarn test\n--watch' }), generic('Terminal')))
            .toBe('yarn test');
        // The name is kept for a call that has nothing else to say.
        expect(rowSnapshot(toolCall('shell', {}), generic('Terminal'))).toBe('Terminal');
        // So is the agent's own note on the call, which names it outright.
        expect(rowSnapshot(toolCall('Bash', { command: 'yarn deploy' }, { description: 'Deploy to staging' }), generic('Terminal')))
            .toBe('Deploy to staging');
        // A title read out of the call already names it and stands alone.
        expect(rowSnapshot(toolCall('Bash', { command: 'yarn deploy' }), named('Deploy to staging')))
            .toBe('Deploy to staging');
    });

    it('has a step to name even when the title runs long', () => {
        const long = toolSnapshot(tool('Bash', { command: 'yarn deploy' }), named(`Run ${'a'.repeat(400)}`))!;
        expect(long.length).toBeLessThanOrEqual(120);
        expect(long.endsWith('…')).toBe(true);
        // Both parts together are clipped too, not just the title.
        const joined = toolSnapshot(tool('Other', { command: 'y'.repeat(400) }), generic('Terminal'))!;
        expect(joined.length).toBeLessThanOrEqual(120);
        expect(joined.endsWith('…')).toBe(true);
    });

    it('falls back to the call\'s own words when there is no title', () => {
        // The description is what the agent wrote about the call.
        expect(rowSnapshot(toolCall('Bash', {}, { description: 'Deploy to staging' })))
            .toBe('Deploy to staging');
        // With nothing said at all, the input still says what it is working on.
        expect(rowSnapshot(toolCall('Read', { file_path: '/app/LoginButton.tsx' })))
            .toBe('Read /app/LoginButton.tsx');
        expect(rowSnapshot(toolCall('Grep', { pattern: 'borderRadius' })))
            .toBe('Grep borderRadius');
        expect(rowSnapshot(toolCall('Bash', {}))).toBe('Bash');
    });

    it('keeps a command to its first line', () => {
        expect(rowSnapshot(toolCall('Bash', { command: 'yarn test login\n--verbose\n--watch' })))
            .toBe('Bash yarn test login');
    });

    it('ignores a subject field that is not a usable string', () => {
        expect(rowSnapshot(toolCall('Edit', { file_path: '   ', path: '/app/a.ts' })))
            .toBe('Edit /app/a.ts');
    });

    it('takes the first line of agent text', () => {
        const message: Message = {
            kind: 'agent-text', id: 'a1', localId: null, createdAt: 0,
            text: '\n\n找到了，圆角写死在样式表里。\n后面还有一段。',
        };
        expect(rowSnapshot(message)).toBe('找到了，圆角写死在样式表里。');
    });

    it('has nothing for a row that is not a step', () => {
        const message: Message = { kind: 'user-text', id: 'u1', localId: null, createdAt: 0, text: 'hi' };
        expect(rowSnapshot(message)).toBeNull();
        expect(rowSnapshot({ kind: 'agent-text', id: 'a1', localId: null, createdAt: 0, text: '   ' })).toBeNull();
    });

    it('keeps a long subject readable rather than cutting it mid-word silently', () => {
        const long = 'x'.repeat(400);
        const snapshot = rowSnapshot(toolCall('Bash', { command: long }))!;
        expect(snapshot.length).toBeLessThanOrEqual(120);
        expect(snapshot.endsWith('…')).toBe(true);
    });
});
