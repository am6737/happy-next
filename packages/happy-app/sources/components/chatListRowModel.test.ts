import { describe, expect, it } from 'vitest';
import { chatRowModelsAreEqual, buildChatRowModels, distanceFromEnd, listIndexFromNewestFirst, toListOrder, ChatRowModel } from './chatListRowModel';
import type { TurnHeaderStatus } from './messageTurnTiming';
import { AgentTextMessage, Message, ToolCallMessage, UserTextMessage } from '@/sync/typesMessage';

function userText(id: string, overrides: Partial<UserTextMessage> = {}): UserTextMessage {
    return { kind: 'user-text', id, localId: null, createdAt: 0, text: `prompt ${id}`, ...overrides };
}

function agentText(id: string, overrides: Partial<AgentTextMessage> = {}): AgentTextMessage {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: `reply ${id}`, ...overrides };
}

function toolCall(id: string): ToolCallMessage {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        tool: {
            name: 'Read',
            state: 'completed',
            input: null,
            createdAt: 0,
            startedAt: null,
            completedAt: null,
            description: null,
        },
        children: [],
    };
}

/** The messages of a conversation, newest first — the order the store hands them over. */
function build(
    messages: Message[],
    overrides: Partial<Parameters<typeof buildChatRowModels>[0]> = {},
): ChatRowModel[] {
    return buildChatRowModels({
        visibleMessages: messages,
        completedIds: new Set<string>(),
        headerById: new Map<string, TurnHeaderStatus>(),
        senderVisibility: null,
        forkingMessageId: null,
        ...overrides,
    });
}

/** A settled turn's reply: the newest agent row, with the action bar the turn analysis grants it. */
function settled(messages: Message[]): ChatRowModel[] {
    const newestAgent = messages.find((message) => message.kind === 'agent-text')!;
    return build(messages, { completedIds: new Set([newestAgent.id]) });
}

describe('buildChatRowModels', () => {
    it('keeps the newest-first order and marks only the first row as newest', () => {
        const rows = build([agentText('a'), userText('b'), agentText('c')]);
        expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c']);
        expect(rows.map((row) => row.isNewestMessage)).toEqual([true, false, false]);
    });

    it('gives every non-agent row the action bar, and an agent row only once its turn settled', () => {
        const messages = [agentText('fresh'), toolCall('call'), userText('prompt')];
        expect(build(messages).map((row) => row.showActionBar)).toEqual([false, true, true]);
        expect(settled(messages).map((row) => row.showActionBar)).toEqual([true, true, true]);
    });

    it('points an agent row at the nearest NEWER prompt, not at its neighbour', () => {
        // Newest first: a tool call stands between the reply and the prompt that came after it, and
        // the walk keeps that prompt in hand for every older row below.
        const rows = build([userText('next'), toolCall('call'), agentText('reply'), userText('earlier')]);
        expect(rows[0].forkTarget).toBeNull();
        expect(rows[2].forkTarget).toBe(rows[0].message);
        expect(rows[3].forkTarget).toBe(rows[0].message);
    });

    it('gives each reply the prompt nearest above it, so a newer reply takes a newer prompt', () => {
        const rows = build([userText('newest prompt'), agentText('reply A'), userText('older prompt'), agentText('reply B')]);
        expect(rows[1].forkTarget?.id).toBe('newest prompt');
        expect(rows[3].forkTarget?.id).toBe('older prompt');
    });

    it('leaves the newest reply with no target, so a fork from it duplicates the session whole', () => {
        const rows = build([agentText('newest reply'), userText('prompt')]);
        expect(rows[0].forkTarget).toBeNull();
    });

    it('never takes a non-user row as a fork target', () => {
        const rows = build([agentText('reply'), toolCall('call'), agentText('working')]);
        expect(rows[0].forkTarget).toBeNull();
    });

    it('flattens a running turn to a null completedAt and leaves a row that opens no turn undefined', () => {
        const headerById = new Map<string, TurnHeaderStatus>([
            ['reply', { state: 'running', startedAt: 12 }],
        ]);
        const rows = build([agentText('reply'), userText('prompt')], { headerById });
        expect([rows[0].isTurnStart, rows[0].turnStartedAt, rows[0].turnCompletedAt]).toEqual([true, 12, null]);
        expect([rows[1].isTurnStart, rows[1].turnStartedAt, rows[1].turnCompletedAt]).toEqual([false, undefined, undefined]);
    });

    it('flattens a settled turn to its completion time', () => {
        const headerById = new Map<string, TurnHeaderStatus>([
            ['reply', { state: 'done', startedAt: 12, completedAt: 30 }],
        ]);
        const rows = build([agentText('reply')], { headerById });
        expect([rows[0].isTurnStart, rows[0].turnStartedAt, rows[0].turnCompletedAt]).toEqual([true, 12, 30]);
    });

    it('marks only the row the fork is running on', () => {
        const rows = build([agentText('a'), userText('b')], { forkingMessageId: 'b' });
        expect(rows.map((row) => row.forkLoading)).toEqual([false, true]);
    });

    // A shared session's rows show a sender label, and only the first of a same-sender run does.
    it('reads sender labels off the map the list computed', () => {
        const senderVisibility = new Map([['a', true], ['b', false]]);
        const rows = build([agentText('a'), userText('b'), userText('c')], { senderVisibility });
        expect(rows.map((row) => row.showSenderName)).toEqual([true, false, false]);
    });

    it('shows no sender label when the session is not shared', () => {
        const rows = build([userText('a')], { senderVisibility: null });
        expect(rows.map((row) => row.showSenderName)).toEqual([false]);
    });
});

describe('chatRowModelsAreEqual', () => {
    it('treats a rebuilt row carrying the same message as unchanged', () => {
        const message = agentText('a');
        const [before] = build([message]);
        const [after] = build([message]);
        expect(after).not.toBe(before);
        expect(chatRowModelsAreEqual(before, after)).toBe(true);
    });

    it('sees a rewritten message', () => {
        const [before] = build([agentText('a', { text: 'half a re' })]);
        const [after] = build([agentText('a', { text: 'half a reply' })]);
        expect(chatRowModelsAreEqual(before, after)).toBe(false);
    });

    it('sees a turn settling, which is what puts the action bar on a reply', () => {
        const message = agentText('reply');
        const [before] = build([message]);
        const [after] = settled([message]);
        expect(before.showActionBar).toBe(false);
        expect(chatRowModelsAreEqual(before, after)).toBe(false);
    });

    it('sees a turn header moving from running to done', () => {
        const message = agentText('reply');
        const running = new Map<string, TurnHeaderStatus>([['reply', { state: 'running', startedAt: 1 }]]);
        const done = new Map<string, TurnHeaderStatus>([['reply', { state: 'done', startedAt: 1, completedAt: 9 }]]);
        const [wasRunning] = build([message], { headerById: running });
        const [nowDone] = build([message], { headerById: done });
        expect(chatRowModelsAreEqual(wasRunning, nowDone)).toBe(false);
    });

    it('sees a fork spinner turning on and off', () => {
        const message = userText('a');
        const [off] = build([message]);
        const [on] = build([message], { forkingMessageId: 'a' });
        expect(chatRowModelsAreEqual(off, on)).toBe(false);
    });

    it('sees a row losing the newest-message marker when a newer one arrives', () => {
        const message = agentText('a');
        const [wasNewest] = build([message]);
        const [nowSecond] = build([agentText('b'), message]);
        expect(chatRowModelsAreEqual(wasNewest, nowSecond)).toBe(false);
    });

    it('sees a fork target changing under an agent row', () => {
        const reply = agentText('reply');
        const tail = toolCall('call');
        const [noTarget] = build([agentText('something else'), reply, tail]);
        const [withTarget] = build([userText('prompt'), reply, tail]);
        expect(chatRowModelsAreEqual(noTarget, withTarget)).toBe(false);
    });

    it('sees a sender label appearing', () => {
        const message = userText('a');
        const [unlabelled] = build([message]);
        const [labelled] = build([message], { senderVisibility: new Map([['a', true]]) });
        expect(chatRowModelsAreEqual(unlabelled, labelled)).toBe(false);
    });
});

describe('toListOrder', () => {
    it('reverses the rows for the list without touching the newest-first order', () => {
        const rows = build([agentText('a'), userText('b'), agentText('c')]);
        const ordered = toListOrder(rows);
        expect(ordered.map((row) => row.key)).toEqual(['c', 'b', 'a']);
        expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c']);
    });

    // The models carry identity into the list, so the memory savings of `keyExtractor` survive.
    it('reuses the same row objects rather than rebuilding them', () => {
        const rows = build([agentText('a'), agentText('b')]);
        expect(toListOrder(rows)[0]).toBe(rows[1]);
    });

    it('leaves an empty conversation empty', () => {
        expect(toListOrder(build([]))).toEqual([]);
    });
});

describe('list order index translation', () => {
    it('flips the newest-first index of a row to the list’s oldest-first index', () => {
        expect(listIndexFromNewestFirst(0, 3)).toBe(2);
        expect(listIndexFromNewestFirst(2, 3)).toBe(0);
    });

    // Applying it twice is the identity, which is what makes it usable from either end.
    it('is its own inverse', () => {
        for (let count = 1; count <= 5; count++) {
            for (let index = 0; index < count; index++) {
                expect(listIndexFromNewestFirst(listIndexFromNewestFirst(index, count), count)).toBe(index);
            }
        }
    });

    it('places a single row at zero either way round', () => {
        expect(listIndexFromNewestFirst(0, 1)).toBe(0);
    });
});

describe('distanceFromEnd', () => {
    it('measures how far the viewport bottom sits above the content end', () => {
        expect(distanceFromEnd({
            contentOffset: { y: 400 },
            contentSize: { height: 2000 },
            layoutMeasurement: { height: 800 },
        })).toBe(800);
    });

    it('is zero at the end', () => {
        expect(distanceFromEnd({
            contentOffset: { y: 1200 },
            contentSize: { height: 2000 },
            layoutMeasurement: { height: 800 },
        })).toBe(0);
    });

    // End-aligned content shorter than the viewport, and an overscroll past the end, both read as
    // being at the end rather than as a negative distance.
    it('clamps content shorter than the viewport to zero', () => {
        expect(distanceFromEnd({
            contentOffset: { y: 0 },
            contentSize: { height: 300 },
            layoutMeasurement: { height: 800 },
        })).toBe(0);
    });

    it('clamps an overscroll past the end to zero', () => {
        expect(distanceFromEnd({
            contentOffset: { y: 1400 },
            contentSize: { height: 2000 },
            layoutMeasurement: { height: 800 },
        })).toBe(0);
    });
});

describe('committed chat row reuse', () => {
    it('reuses the entire dataset on an equivalent analysis/heartbeat', () => {
        const messages = [agentText('reply'), userText('prompt')];
        const previousRows = build(messages);
        expect(build(messages.slice(), { previousRows })).toBe(previousRows);
    });

    it('allocates only the streaming row in a 10,000-message history', () => {
        const messages: Message[] = Array.from({ length: 10000 }, (_, index) =>
            index % 10 === 9 ? userText(`u${index}`) : agentText(`a${index}`));
        const previousRows = build(messages);
        const nextMessages = [{ ...messages[0], text: 'updated body' } as Message, ...messages.slice(1)];
        const rows = build(nextMessages, { previousRows });
        expect(rows[0]).not.toBe(previousRows[0]);
        expect(rows.slice(1).every((row, index) => row === previousRows[index + 1])).toBe(true);
        expect(previousRows[0].message).toBe(messages[0]);
    });

    it('reuses history by key when messages arrive or older history is prepended visually', () => {
        const messages = [agentText('a'), userText('u'), agentText('old')];
        const previousRows = build(messages);
        const added = build([agentText('new'), ...messages], { previousRows });
        expect(added[1]).not.toBe(previousRows[0]); // no longer newest
        expect(added[2]).toBe(previousRows[1]);
        expect(added[3]).toBe(previousRows[2]);
        const paged = build([...messages, userText('older')], { previousRows });
        expect(paged.slice(0, 3)).toEqual(previousRows);
        expect(paged.slice(0, 3).every((row, index) => row === previousRows[index])).toBe(true);
    });

    it('invalidates fork targets when a newer prompt is edited', () => {
        const prompt = userText('u');
        const reply = agentText('a');
        const previousRows = build([prompt, reply]);
        const editedPrompt = { ...prompt, text: 'edited prompt' };
        const rows = build([editedPrompt, reply], { previousRows });
        expect(rows[1]).not.toBe(previousRows[1]);
        expect(rows[1].forkTarget).toBe(editedPrompt);
    });

    it('preserves every derived input when reusing rows across state changes', () => {
        const messages = [agentText('a'), userText('u')];
        const cases: Array<Partial<Parameters<typeof buildChatRowModels>[0]>> = [
            { completedIds: new Set(['a']) },
            { forkingMessageId: 'u' },
            { senderVisibility: new Map([['u', true]]) },
            { headerById: new Map([['a', { state: 'running', startedAt: 12 }]]) },
            { headerById: new Map([['a', { state: 'done', startedAt: 12, completedAt: 30 }]]) },
            {},
        ];
        let previousRows = build(messages);
        for (const overrides of cases) {
            previousRows.forEach(Object.freeze);
            Object.freeze(previousRows);
            const next = build(messages, { ...overrides, previousRows });
            expect(next).toEqual(build(messages, overrides));
            previousRows = next;
        }
    });

    it('handles removal, reorder, acknowledgement ID replacement and empty history without stale rows', () => {
        const messages = [agentText('a'), userText('u'), agentText('old')];
        let previousRows = build(messages);
        const histories = [
            [messages[0], messages[2]],
            [messages[2], messages[0]],
            [{ ...messages[0], id: 'server-ack' }, messages[2]],
            [messages[0]],
            [],
            messages,
        ];
        for (const history of histories) {
            const next = build(history, { previousRows });
            expect(next).toEqual(build(history));
            previousRows = next;
        }
    });
});
