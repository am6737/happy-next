import { describe, expect, it } from 'vitest';
import { analyzeTurns } from './messageTurnTiming';
import { ASK_USER_QUESTION_TOOL, AgentTextMessage, Message, UserTextMessage } from '@/sync/typesMessage';

function user(id: string, createdAt: number): UserTextMessage {
    return { kind: 'user-text', id, localId: null, createdAt, text: id };
}

function agent(id: string, createdAt: number, overrides: Partial<AgentTextMessage> = {}): AgentTextMessage {
    return { kind: 'agent-text', id, localId: null, createdAt, text: id, ...overrides };
}

function tool(id: string, createdAt: number): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        tool: {
            name: 'Read',
            state: 'completed',
            input: {},
            createdAt,
            startedAt: createdAt,
            completedAt: createdAt,
            description: null,
        },
        children: [],
    };
}

function event(id: string, createdAt: number): Message {
    return { kind: 'agent-event', id, createdAt, event: { type: 'ready' } };
}

function namedTool(id: string, createdAt: number, name: string): Message {
    const call = tool(id, createdAt);
    return { ...(call as { kind: 'tool-call' }), tool: { ...(call as any).tool, name } } as Message;
}

/** A question card — one of the two rows the conversation rail marks. */
function question(id: string, createdAt: number): Message {
    return namedTool(id, createdAt, ASK_USER_QUESTION_TOOL);
}

const NO_LATCH: ReadonlySet<string> = new Set<string>();
const NO_ENDS: ReadonlyMap<string, number> = new Map<string, number>();

function done(result: ReturnType<typeof analyzeTurns>, rowId: string) {
    const header = result.headerById.get(rowId);
    return header?.state === 'done' ? { startedAt: header.startedAt, completedAt: header.completedAt } : undefined;
}

function analyze(
    visibleMessages: Message[],
    options: {
        inFlight?: boolean;
        latched?: ReadonlySet<string>;
        ends?: ReadonlyMap<string, number>;
        taskCompletedAt?: number | null;
        now?: number;
    } = {},
) {
    return analyzeTurns({
        visibleMessages,
        turnInFlight: options.inFlight ?? false,
        previouslyCompleted: options.latched ?? NO_LATCH,
        turnEnds: options.ends ?? NO_ENDS,
        taskCompletedAt: options.taskCompletedAt,
        now: options.now ?? 1_000_000,
    });
}

describe('action bar rows', () => {
    it('puts the bar on the last text block of a settled turn', () => {
        const result = analyze([agent('a1', 20), user('u1', 10)]);
        expect([...result.completedIds]).toEqual(['a1']);
        expect(result.running).toBeNull();
    });

    it('moves the bar to a newer text block as the turn grows', () => {
        const result = analyze([agent('a2', 30), tool('t1', 25), agent('a1', 20), user('u1', 10)]);
        expect([...result.completedIds]).toEqual(['a2']);
    });

    it('ignores thinking rows', () => {
        const result = analyze([agent('think', 30, { isThinking: true }), agent('a1', 20), user('u1', 10)]);
        expect([...result.completedIds]).toEqual(['a1']);
    });

    it('gives older turns their bar while the newest one runs', () => {
        const result = analyze([agent('a2', 40), user('u2', 30), agent('a1', 20), user('u1', 10)], { inFlight: true });
        expect([...result.completedIds]).toEqual(['a1']);
    });

    it('holds a latched row settled when the in-flight flag flips back on', () => {
        const result = analyze([agent('a1', 20), user('u1', 10)], { inFlight: true, latched: new Set(['a1']) });
        expect([...result.completedIds]).toEqual(['a1']);
        expect(result.running).toBeNull();
    });
});

describe('turn headers', () => {
    it('sits above the first row of the turn', () => {
        const result = analyze([agent('a2', 30), agent('a1', 20), user('u1', 10)]);
        expect([...result.headerById.keys()]).toEqual(['a1']);
    });

    it('opens the turn on a tool call when that is what came first', () => {
        const result = analyze([agent('a1', 30), tool('t1', 20), user('u1', 10)]);
        expect([...result.headerById.keys()]).toEqual(['t1']);
    });

    it('leaves mode switches and other notices out of the slot', () => {
        const result = analyze([agent('a1', 30), event('e1', 20), user('u1', 10)]);
        expect([...result.headerById.keys()]).toEqual(['a1']);
    });

    it('gives each turn its own header', () => {
        const result = analyze([agent('a2', 40), user('u2', 30), agent('a1', 20), user('u1', 10)]);
        expect([...result.headerById.keys()]).toEqual(['a1', 'a2']);
    });

    it('has no header before the turn has produced anything', () => {
        const result = analyze([user('u1', 10)], { inFlight: true });
        expect(result.headerById.size).toBe(0);
        expect(result.running).toEqual({ lastTextId: null });
    });

    it('counts the turn as running while the agent works, and measures from the prompt', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)], { inFlight: true });
        expect(result.headerById.get('a1')).toEqual({ state: 'running', startedAt: 10 });
        expect(done(result, 'a1')).toBeUndefined();
    });

    it('reports a settled turn as done', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)], { ends: new Map([['a1', 95]]) });
        expect(result.headerById.get('a1')).toEqual({ state: 'done', startedAt: 10, completedAt: 95 });
    });
});

describe('turn ends', () => {
    it('prefers the end this client watched', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)], { ends: new Map([['a1', 95]]) });
        expect(done(result, 'a1')).toEqual({ startedAt: 10, completedAt: 95 });
    });

    it('falls back to the CLI task stamp for the newest turn', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)], { taskCompletedAt: 95 });
        expect(done(result, 'a1')).toEqual({ startedAt: 10, completedAt: 95 });
    });

    it('withholds a task stamp from turns older than the newest', () => {
        const result = analyze([agent('a2', 60), user('u2', 50), agent('a1', 40), user('u1', 10)], {
            taskCompletedAt: 95,
        });
        expect(done(result, 'a2')).toEqual({ startedAt: 50, completedAt: 95 });
        // The older reply still measures — from its own last row, not the CLI's stamp.
        expect(done(result, 'a1')).toEqual({ startedAt: 10, completedAt: 40 });
    });

    it('ignores a task stamp ahead of our clock', () => {
        // A CLI whose clock runs minutes fast must not hand us a broken duration.
        const result = analyze([agent('a1', 40), user('u1', 10)], { taskCompletedAt: 1_500_000, now: 1_000_000 });
        expect(done(result, 'a1')).toEqual({ startedAt: 10, completedAt: 40 });
    });

    it('ignores a task stamp from before the turn began', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)], { taskCompletedAt: 5 });
        expect(done(result, 'a1')).toEqual({ startedAt: 10, completedAt: 40 });
    });

    it('measures a historical reply from its last row, so every reply shows a duration', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)]);
        expect(done(result, 'a1')).toEqual({ startedAt: 10, completedAt: 40 });
    });

    it('has no duration to show while the turn is in flight', () => {
        const result = analyze([agent('a1', 40), user('u1', 10)], { inFlight: true });
        expect([...result.headerById.values()]).toEqual([{ state: 'running', startedAt: 10 }]);
    });
});

describe('turns above the loaded window', () => {
    it('treats them as one turn that started at its oldest row', () => {
        const result = analyze([agent('a2', 40), agent('a1', 20)]);
        expect([...result.headerById.keys()]).toEqual(['a1']);
        expect(done(result, 'a1')).toEqual({ startedAt: 20, completedAt: 40 });
    });
});

describe('folded turns', () => {
    function fold(result: ReturnType<typeof analyzeTurns>, headerId: string) {
        return result.foldById.get(headerId);
    }

    it('hides the process, keeping the row that opens it and the answer', () => {
        const result = analyze([agent('a1', 50), tool('t2', 40), tool('t1', 30), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 1, snapshotId: 't2', answerId: 'a1', running: false });
    });

    it('hides the working-out between the header and the answer, text included', () => {
        const result = analyze([agent('a1', 50), agent('mid', 40), tool('t1', 30), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['mid'], steps: 0, snapshotId: 'mid', answerId: 'a1', running: false });
    });

    it('counts every tool call it hides, not the rows it hides', () => {
        const result = analyze([
            agent('a1', 60),
            tool('t4', 50),
            agent('mid', 45),
            tool('t3', 40),
            tool('t2', 35),
            tool('t1', 30),
            user('u1', 10),
        ]);
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['t2', 't3', 'mid', 't4'],
            steps: 3,
            snapshotId: 't4',
            answerId: 'a1',
            running: false,
        });
    });

    it('keeps a question the reader may still have to answer', () => {
        const result = analyze([agent('a1', 50), question('q1', 40), tool('t1', 30), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({ hiddenIds: [], steps: 0, snapshotId: null, answerId: 'a1', running: false });
    });

    it('has nothing to hide when the turn is only its answer', () => {
        const result = analyze([agent('a1', 50), user('u1', 10)]);
        expect(fold(result, 'a1')).toEqual({ hiddenIds: [], steps: 0, snapshotId: null, answerId: 'a1', running: false });
    });

    it('folds a running turn to its line alone, answer included', () => {
        // Nothing is kept back but the header: a turn still running has no answer to keep, and the
        // line's snapshot is what stands in for the step it is on.
        const result = analyze([agent('a1', 50), tool('t1', 30), user('u1', 10)], { inFlight: true });
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['a1'], steps: 0, snapshotId: 'a1', answerId: null, running: true });
    });

    it('hands the answer back as soon as the turn settles', () => {
        const rows = [agent('a1', 50), tool('t1', 30), user('u1', 10)];
        const whileRunning = analyze(rows, { inFlight: true });
        const onceSettled = analyze(rows);
        expect(fold(whileRunning, 't1')?.hiddenIds).toEqual(['a1']);
        expect(fold(onceSettled, 't1')?.hiddenIds).toEqual([]);
    });

    it('keeps an answer that is the very row the line sits on', () => {
        // The turn's only text opens it, so the answer and the header are one row: the fold takes the
        // process and leaves that row's own words standing, under the line.
        const result = analyze([tool('t3', 50), tool('t2', 45), tool('t1', 40), agent('a1', 35), user('u1', 10)]);
        expect(fold(result, 'a1')).toEqual({
            hiddenIds: ['t1', 't2', 't3'],
            steps: 3,
            snapshotId: 't3',
            answerId: 'a1',
            running: false,
        });
    });

    it('has no answer to keep when the turn ended without a word of its own', () => {
        const result = analyze([tool('t3', 50), tool('t2', 45), tool('t1', 40), user('u1', 10)]);
        expect(fold(result, 't1')?.answerId).toBeNull();
    });

    it('snapshots the newest row, which is the one in flight', () => {
        const result = analyze(
            [tool('t3', 50), tool('t2', 40), tool('t1', 30), user('u1', 10)],
            { inFlight: true },
        );
        expect(fold(result, 't1')?.snapshotId).toBe('t3');
    });

    it('folds a settled turn while a newer one runs', () => {
        const result = analyze(
            [agent('a2', 60), user('u2', 50), tool('t2', 45), agent('a1', 40), tool('t1', 30), user('u1', 10)],
            { inFlight: true },
        );
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 1, snapshotId: 't2', answerId: 'a1', running: false });
        // The running turn folds too, and keeps nothing back.
        expect(fold(result, 'a2')).toEqual({ hiddenIds: [], steps: 0, snapshotId: null, answerId: null, running: true });
    });

    it('never reaches across a prompt into the turn before it', () => {
        const result = analyze(
            [agent('a2', 60), user('u2', 50), tool('t2', 45), agent('a1', 40), tool('t1', 30), user('u1', 10)],
        );
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 1, snapshotId: 't2', answerId: 'a1', running: false });
        // The newer turn's own process is all it hides: its prompt is a boundary, not a row.
        expect(fold(result, 'a2')).toEqual({ hiddenIds: [], steps: 0, snapshotId: null, answerId: 'a2', running: false });
    });
});
