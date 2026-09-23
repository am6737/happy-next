import { describe, expect, it } from 'vitest';
import { analyzeTurns } from './messageTurnTiming';
import { ASK_USER_QUESTION_TOOL, AgentTextMessage, Message, UserTextMessage } from '@/sync/typesMessage';

const PLAN_PROPOSAL_TOOL = 'ExitPlanMode';

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

/** A notice the CLI wrote into the conversation — a title change, a mode switch, a usage limit. */
function event(id: string, createdAt: number): Message {
    return { kind: 'agent-event', id, createdAt, event: { type: 'message', message: id } };
}

function namedTool(id: string, createdAt: number, name: string): Message {
    const call = tool(id, createdAt);
    return { ...(call as { kind: 'tool-call' }), tool: { ...(call as any).tool, name } } as Message;
}

/** A question card — one of the two rows the conversation rail marks. */
function question(id: string, createdAt: number): Message {
    return namedTool(id, createdAt, ASK_USER_QUESTION_TOOL);
}

/** A plan proposal — a request like any other: the card is what the reader approves or rejects. */
function planProposal(id: string, createdAt: number, status: 'pending' | 'approved' | 'denied' = 'pending', name = PLAN_PROPOSAL_TOOL): Message {
    return awaitingPermission(id, createdAt, status, name);
}

/** A tool call the agent is blocked on: nothing moves until the reader answers the request. */
function awaitingPermission(id: string, createdAt: number, status: 'pending' | 'approved' | 'denied' = 'pending', name = 'Read'): Message {
    const call = namedTool(id, createdAt, name) as { kind: 'tool-call'; tool: Record<string, unknown> };
    return { ...call, tool: { ...call.tool, permission: { id: `perm-${id}`, status } } } as Message;
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
        // The list keeps t1 to carry the line, but the line takes its content like everything else
        // under it — so both calls are steps the folded line reports, not just the one it drops.
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 2, snapshotId: 't2', answerId: 'a1' });
    });

    it('keeps the words a turn wrote after its last step, not merely its answer', () => {
        const result = analyze([agent('a1', 50), agent('mid', 40), tool('t1', 30), user('u1', 10)]);
        // The tool is the last thing the agent did, so everything it wrote after it answers the prompt —
        // `mid` included, not only the closing block. A folded turn that hid the report and left the
        // postscript under its line would be saying nothing about the turn at all.
        expect(fold(result, 't1')).toEqual({ hiddenIds: [], steps: 1, snapshotId: 't1', answerId: 'a1' });
    });

    it('hides the words a turn wrote before its last step', () => {
        const result = analyze([
            agent('a1', 60),
            tool('t2', 50),
            agent('mid', 40),
            tool('t1', 30),
            user('u1', 10),
        ]);
        // The agent narrated, took a step, then wrote its report: the narration led up to the step and
        // goes with it, the report is what the reader is here for and stays.
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['mid', 't2'],
            steps: 2,
            snapshotId: 't2',
            answerId: 'a1',
        });
    });

    it('keeps a report and the postscript after it, both', () => {
        const result = analyze([
            agent('closing', 90),
            agent('report', 80),
            tool('t3', 70),
            agent('narration', 60),
            tool('t2', 50),
            tool('t1', 40),
            user('u1', 10),
        ]);
        // The shape that settled this rule: steps, a line of narration, a last step, then the report the
        // reader asked for and a short note after it. Everything from the report down is the answer.
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['t2', 'narration', 't3'],
            steps: 3,
            snapshotId: 't3',
            answerId: 'closing',
        });
    });

    it('keeps the last word of a turn that ended on a step', () => {
        const result = analyze([tool('t2', 50), agent('mid', 40), tool('t1', 30), user('u1', 10)]);
        // Nothing follows the final step, so the reach alone would take the whole reply. The agent's last
        // word is a row above that step, and the fold keeps it rather than leaving a bare line.
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 2, snapshotId: 't2', answerId: 'mid' });
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
            // t1 is the turn's header and the fourth call the fold takes out of sight: the line stands
            // where its content was.
            steps: 4,
            snapshotId: 't4',
            answerId: 'a1',
        });
    });

    it('keeps a question the reader may still have to answer', () => {
        const result = analyze([agent('a1', 50), question('q1', 40), tool('t1', 30), user('u1', 10)]);
        // The card stays where it is, and the line is drawn on the tool call above it, whose content it
        // takes: one step, nothing dropped.
        expect(fold(result, 't1')).toEqual({ hiddenIds: [], steps: 1, snapshotId: 't1', answerId: 'a1' });
    });

    it('keeps a question that opens the turn, the very row the line lands on', () => {
        // The agent asked first, so the question card is the turn's header: the fold draws its line on
        // that row. The card keeps its content there (foldedLineKeepsRow), and it is kept out of the
        // rows the fold drops here — either half missing is the question disappearing from the list.
        const result = analyze([agent('a1', 50), tool('t1', 40), question('q1', 30), user('u1', 10)]);
        expect(fold(result, 'q1')).toEqual({
            hiddenIds: ['t1'],
            steps: 1,
            snapshotId: 't1',
            answerId: 'a1',
        });
        expect(result.headerById.get('q1')?.state).toBe('done');
    });

    it('keeps a plan proposal the reader has not answered yet', () => {
        // The agent proposed a plan mid-turn, and the reader is the one who answers it: folding the
        // turn's progress must not take the plan — or the buttons that answer it — off the screen. It
        // is a request, not working-out, so it is not counted either: the line counts the rows it hides.
        const result = analyze([agent('a1', 60), tool('t3', 50), planProposal('p1', 40), tool('t2', 30), tool('t1', 20), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['t2', 't3'],
            steps: 3,
            snapshotId: 't3',
            answerId: 'a1',
        });
    });

    it('keeps the snake_case plan proposal too', () => {
        const result = analyze([agent('a1', 50), planProposal('p1', 40, 'pending', 'exit_plan_mode'), tool('t1', 30), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({ hiddenIds: [], steps: 1, snapshotId: 't1', answerId: 'a1' });
    });

    it('keeps a plan proposal that opens the turn, the very row the line lands on', () => {
        // The turn's first row is the proposal, so the line is drawn on it: the card keeps its content
        // there (foldedLineKeepsRow), and the walk leaves it out of the dropped rows. Either half
        // missing is the plan disappearing from the list.
        const result = analyze([agent('a1', 50), tool('t1', 40), planProposal('p1', 30), user('u1', 10)]);
        expect(fold(result, 'p1')).toEqual({
            hiddenIds: ['t1'],
            steps: 1,
            snapshotId: 't1',
            answerId: 'a1',
        });
        expect(result.headerById.get('p1')?.state).toBe('done');
    });

    it('folds a plan proposal the reader has answered like any other step', () => {
        // Answered is process: the reader approved or rejected the plan and the card has nothing left
        // to ask, so it folds, it counts, and the line's snapshot moves onto it.
        const result = analyze([agent('a1', 60), tool('t3', 50), planProposal('p1', 40, 'approved'), tool('t2', 30), tool('t1', 20), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['t2', 'p1', 't3'],
            steps: 4,
            snapshotId: 't3',
            answerId: 'a1',
        });
    });

    it('folds an answered plan proposal that opens the turn, the very row the line lands on', () => {
        const result = analyze([agent('a1', 50), tool('t1', 40), planProposal('p1', 30, 'denied'), user('u1', 10)]);
        expect(fold(result, 'p1')).toEqual({
            hiddenIds: ['t1'],
            steps: 2,
            snapshotId: 't1',
            answerId: 'a1',
        });
        expect(result.headerById.get('p1')?.state).toBe('done');
    });

    it('keeps a notice the CLI wrote, the only trace of what it reports', () => {
        // The turn renamed the session as it worked. That row is not process — it is the one place the
        // new title is recorded, and the agent's own words never mention it — so the fold leaves it
        // standing, and does not count it either: the line counts the rows it hides.
        const result = analyze([agent('a1', 50), tool('t2', 40), event('e1', 30), tool('t1', 20), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['t2'],
            steps: 2,
            snapshotId: 't2',
            answerId: 'a1',
        });
    });

    it('names a hidden step on the running line, keeping the notice beside it out of the snapshot', () => {
        // The notice is on screen as a row of its own, so the line says what it is hiding instead.
        const result = analyze([event('e1', 40), tool('t1', 30), user('u1', 10)], { inFlight: true });
        expect(fold(result, 't1')).toEqual({ hiddenIds: [], steps: 1, snapshotId: 't1', answerId: null });
    });

    it('keeps a step the agent is waiting on a permission for', () => {
        // The agent asked to do something and nothing moves until the reader answers: taking that row
        // away would take the request away with it. It is a prompt, not working-out, so the line does
        // not count it either.
        const result = analyze([agent('a1', 60), tool('t3', 50), awaitingPermission('p1', 40), tool('t2', 30), tool('t1', 20), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({
            hiddenIds: ['t2', 't3'],
            steps: 3,
            snapshotId: 't3',
            answerId: 'a1',
        });
    });

    it('never ends the fold\'s reach on a step that is waiting on a permission', () => {
        // The newest thing the agent did is ask; the reach stops at the step before it, so the
        // request is not inside the rows the fold would take.
        const result = analyze([agent('a1', 50), awaitingPermission('p1', 40), tool('t1', 30), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({ hiddenIds: [], steps: 1, snapshotId: 't1', answerId: 'a1' });
    });

    it('folds a step whose permission has been answered like any other', () => {
        // Answered is process: the reader has had their say, and the row has nothing left to ask.
        const result = analyze([agent('a1', 50), awaitingPermission('p1', 40, 'approved'), tool('t1', 30), user('u1', 10)]);
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['p1'], steps: 2, snapshotId: 'p1', answerId: 'a1' });
    });

    it('has nothing to hide when the turn is only its answer', () => {
        const result = analyze([agent('a1', 50), user('u1', 10)]);
        expect(fold(result, 'a1')).toEqual({ hiddenIds: [], steps: 0, snapshotId: null, answerId: 'a1' });
    });

    it('folds a running turn to its line alone, answer included', () => {
        // Nothing is kept back but the header: a turn still running has no answer to keep, and the
        // line's snapshot is what stands in for the step it is on.
        const result = analyze([agent('a1', 50), tool('t1', 30), user('u1', 10)], { inFlight: true });
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['a1'], steps: 1, snapshotId: 'a1', answerId: null });
    });

    it('folds a running turn from the step it opens with', () => {
        // The line is drawn on that first tool call, so the fold has no row to take out of the list —
        // but the line still stands in for it, which is what lets a turn fold from its very first step
        // instead of showing a full tool row until a second one arrives.
        const result = analyze([tool('t1', 30), user('u1', 10)], { inFlight: true });
        expect(fold(result, 't1')).toEqual({
            hiddenIds: [],
            steps: 1,
            snapshotId: 't1',
            answerId: null,
        });
    });

    it('counts no step for a running turn that is only writing', () => {
        // Nothing to fold yet: words being written are the thing the reader is watching, and the line
        // has no step to stand for.
        const result = analyze([agent('a1', 30), user('u1', 10)], { inFlight: true });
        expect(fold(result, 'a1')?.steps).toBe(0);
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
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 2, snapshotId: 't2', answerId: 'a1' });
        // The newer turn is only its own text so far: it keeps nothing back either, and has no step for
        // a line to report.
        expect(fold(result, 'a2')).toEqual({ hiddenIds: [], steps: 0, snapshotId: 'a2', answerId: null });
    });

    it('never reaches across a prompt into the turn before it', () => {
        const result = analyze(
            [agent('a2', 60), user('u2', 50), tool('t2', 45), agent('a1', 40), tool('t1', 30), user('u1', 10)],
        );
        expect(fold(result, 't1')).toEqual({ hiddenIds: ['t2'], steps: 2, snapshotId: 't2', answerId: 'a1' });
        // The newer turn's own process is all it hides: its prompt is a boundary, not a row. That row
        // is the answer as well, so the line keeps its content and hides nothing at all.
        expect(fold(result, 'a2')).toEqual({ hiddenIds: [], steps: 0, snapshotId: null, answerId: 'a2' });
    });
});

describe('native analysis without unused fold snapshots', () => {
    it.each([true, false, undefined])('keeps headers, completion latches and actions identical (in flight: %s)', (turnInFlight) => {
        const visibleMessages = [
            agent('new-reply', 90), tool('new-tool', 80), user('new-prompt', 70),
            agent('old-reply', 60), tool('old-tool', 50), user('old-prompt', 40),
            event('notice', 30), tool('partial-tool', 20), agent('partial-reply', 10),
        ];
        const params = {
            visibleMessages, turnInFlight, previouslyCompleted: new Set<string>(),
            turnEnds: new Map([['old-reply', 65]]), taskCompletedAt: 95, now: 100,
        };
        const full = analyzeTurns(params);
        const native = analyzeTurns({ ...params, includeFold: false });
        expect(native).toEqual({ ...full, foldById: new Map() });
        expect(full.foldById.size).toBeGreaterThan(0); // default web path still computes folds
    });
});
