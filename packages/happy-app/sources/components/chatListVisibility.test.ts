import { describe, expect, it } from 'vitest';
import { currentLandmark, railLandmarkRows, shouldHideMessageInMinimap, shouldHideMessageInChatList, LandmarkRow } from './chatListVisibility';
import { AgentTextMessage, MinimapMessage, ToolCallMessage, UserTextMessage } from '@/sync/typesMessage';

function toolCall(name: string): ToolCallMessage {
    return {
        kind: 'tool-call',
        id: `call-${name}`,
        localId: null,
        createdAt: 0,
        tool: {
            name,
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

function agentText(overrides: Partial<AgentTextMessage> = {}): AgentTextMessage {
    return {
        kind: 'agent-text',
        id: 'agent-1',
        localId: null,
        createdAt: 0,
        text: 'hello',
        ...overrides,
    };
}

function userText(text: string, overrides: Partial<UserTextMessage> = {}): UserTextMessage {
    return {
        kind: 'user-text',
        id: 'user-1',
        localId: null,
        createdAt: 0,
        text,
        ...overrides,
    };
}

function imagePlaceholder(original: string, displayed: string, scale: string): string {
    return `[Image: original ${original}, displayed at ${displayed}. Multiply coordinates by ${scale} to map to original image.]`;
}

function hideUserText(text: string, showThinkingMessages = true): boolean {
    return shouldHideMessageInChatList(userText(text), showThinkingMessages);
}

describe('shouldHideMessageInChatList', () => {
    it('drops thinking rows when the setting is off', () => {
        expect(shouldHideMessageInChatList(agentText({ isThinking: true }), false)).toBe(true);
    });

    it('keeps thinking rows when the setting is on', () => {
        expect(shouldHideMessageInChatList(agentText({ isThinking: true }), true)).toBe(false);
    });

    it('keeps non-thinking agent rows either way', () => {
        expect(shouldHideMessageInChatList(agentText(), false)).toBe(false);
        expect(shouldHideMessageInChatList(agentText(), true)).toBe(false);
    });

    it('drops compaction markers', () => {
        const marker = '<local-command-stdout>compacted</local-command-stdout>';
        expect(shouldHideMessageInChatList(userText(marker), true)).toBe(true);
        expect(shouldHideMessageInChatList(userText(`  ${marker}  `), true)).toBe(true);
    });

    it('reads displayText over text for user rows', () => {
        const marker = '<local-command-stdout>compacted</local-command-stdout>';
        expect(shouldHideMessageInChatList(userText('visible prompt', { displayText: marker }), true)).toBe(true);
        expect(shouldHideMessageInChatList(userText(marker, { displayText: 'visible prompt' }), true)).toBe(false);
    });

    it('keeps ordinary user rows', () => {
        expect(shouldHideMessageInChatList(userText('hello'), false)).toBe(false);
    });

    // Placeholder shapes taken from the CLI logs (real attachments, various sizes/ratios).
    it('drops image placeholder rows', () => {
        expect(hideUserText(imagePlaceholder('1080x2344', '922x2000', '1.17'))).toBe(true);
        expect(hideUserText(imagePlaceholder('1284x2778', '924x2000', '1.39'))).toBe(true);
        expect(hideUserText(imagePlaceholder('1206x2622', '922x2000', '1.31'))).toBe(true);
        expect(hideUserText(imagePlaceholder('1320x2868', '922x2000', '1.43'))).toBe(true);
        expect(hideUserText(imagePlaceholder('1668x2420', '922x1338', '1.81'))).toBe(true);
        expect(hideUserText(imagePlaceholder('2010x300', '2010x300', '1.00'))).toBe(true);
        expect(hideUserText(`  ${imagePlaceholder('1080x2344', '922x2000', '1.17')}  `)).toBe(true);
    });

    it('keeps a placeholder followed by other text', () => {
        expect(hideUserText(`${imagePlaceholder('1080x2344', '922x2000', '1.17')}\n看看这个`)).toBe(false);
    });

    it('keeps other bracketed image notices', () => {
        expect(hideUserText('[Image: source: /tmp/shot.png]')).toBe(false);
        expect(hideUserText('[Image: original 1080x2344]')).toBe(false);
    });

    it('keeps a row that carries images even when its text matches the placeholder', () => {
        const withImage = userText(imagePlaceholder('1080x2344', '922x2000', '1.17'), {
            images: [{ type: 'image', url: 'https://example.com/a.jpg', width: 1568, height: 1400, mimeType: 'image/jpeg' }],
        });
        expect(shouldHideMessageInChatList(withImage, true)).toBe(false);
    });
});

describe('shouldHideMessageInMinimap', () => {
    const summaryText = 'This session is being continued from a previous conversation that ran out of context.';

    it('drops the post-compaction summary the list still shows', () => {
        const summary = userText(summaryText, { meta: { sentFrom: 'cli', isCompactSummary: true } });
        expect(shouldHideMessageInChatList(summary, true)).toBe(false);
        expect(shouldHideMessageInMinimap(summary)).toBe(true);
    });

    it('keeps ordinary prompts', () => {
        expect(shouldHideMessageInMinimap(userText('hello'))).toBe(false);
        // An explicit false must read the same as an absent flag.
        expect(shouldHideMessageInMinimap(userText('hello', { meta: { isCompactSummary: false } }))).toBe(false);
    });

    it('ignores the summary wording — only the flag decides', () => {
        // A user who quotes the summary's opening line is still a landmark.
        expect(shouldHideMessageInMinimap(userText(summaryText))).toBe(false);
    });

    it('drops rows the list hides, so no marker points at a row that never renders', () => {
        expect(shouldHideMessageInMinimap(userText('<local-command-stdout>compacted</local-command-stdout>'))).toBe(true);
        expect(shouldHideMessageInMinimap(userText(imagePlaceholder('1080x2344', '922x2000', '1.17')))).toBe(true);
        expect(shouldHideMessageInMinimap(userText('visible prompt', {
            displayText: '<local-command-stdout>compacted</local-command-stdout>',
        }))).toBe(true);
    });

    it('keeps image placeholders that carry an image, matching the list', () => {
        const withImage = userText(imagePlaceholder('1080x2344', '922x2000', '1.17'), {
            images: [{ type: 'image', url: 'https://example.com/a.jpg', width: 1568, height: 1400, mimeType: 'image/jpeg' }],
        });
        expect(shouldHideMessageInMinimap(withImage)).toBe(false);
    });

    it('never drops a preview landmark', () => {
        const preview: MinimapMessage = {
            kind: 'preview-html',
            id: 'preview-1',
            localId: null,
            createdAt: 0,
            title: 'Weekly report',
        };
        expect(shouldHideMessageInMinimap(preview)).toBe(false);
    });

    it('never drops a question landmark', () => {
        const question: MinimapMessage = {
            kind: 'ask-user-question',
            id: 'question-1',
            localId: null,
            createdAt: 0,
            questions: [{ header: 'Scope', question: 'Which files?' }],
            answers: null,
        };
        expect(shouldHideMessageInMinimap(question)).toBe(false);
    });
});

describe('railLandmarkRows', () => {
    const prompt = userText('hello', { id: 'prompt' });
    const question = toolCall('AskUserQuestion');
    const reply = agentText({ id: 'reply' });
    const bash = toolCall('Bash');

    it('carries the rows the rail has a mark for, with their index in the list', () => {
        const railIds = new Set(['prompt', question.id]);
        expect(railLandmarkRows([reply, bash, question, prompt], railIds)).toEqual([
            { id: question.id, index: 2 },
            { id: 'prompt', index: 3 },
        ]);
    });

    it('leaves out a row the rail hides, so the reader is never reported on a mark that is not drawn', () => {
        // A compaction summary: the list renders it, `shouldHideMessageInMinimap` keeps it off the rail,
        // and it is exactly the row the reader is on when they scroll up to it.
        const summary = userText('<summary>', { id: 'summary', meta: { sentFrom: 'cli', isCompactSummary: true } });
        const railIds = new Set(['prompt']);
        const rows = railLandmarkRows([summary, prompt], railIds);
        expect(rows).toEqual([{ id: 'prompt', index: 1 }]);
        // And so the rail keeps lighting the prompt for as long as the summary is the last row above.
        expect(currentLandmark(rows, [0, 1])).toBe('prompt');
    });

    it('has nothing to say while the rail is empty', () => {
        expect(railLandmarkRows([prompt, reply], new Set())).toEqual([]);
    });
});

describe('currentLandmark', () => {
    // Four landmarks with room between them: a is the oldest prompt, b is a preview_html call, c and d
    // are prompts. Indexes are into the list's newest-first order, so d is the closest to the bottom.
    const landmarks: LandmarkRow[] = [
        { id: 'd', index: 5 },
        { id: 'c', index: 9 },
        { id: 'b', index: 13 },
        { id: 'a', index: 15 },
    ];

    it('holds the last landmark for as long as the closing reply runs', () => {
        // The reply after d is longer than a screen: no landmark is on screen anywhere in it, and the
        // reader has still been through d.
        expect(currentLandmark(landmarks, [0, 1, 2, 3])).toBe('d');
        expect(currentLandmark(landmarks, [2, 3, 4, 5])).toBe('d');
        expect(currentLandmark(landmarks, [0, 1, 2, 3, 4, 5])).toBe('d');
    });

    it('takes the landmark the reader is looking at over the older one above it', () => {
        // A preview or a question sits right under the prompt that asked for it, so the two share the
        // screen; the reader is on the lower one, which is the newer of the two.
        expect(currentLandmark(landmarks, [12, 13, 14, 15])).toBe('b');
        expect(currentLandmark(landmarks, [13, 14, 15, 16])).toBe('b');
    });

    it('follows the reader back up the conversation', () => {
        expect(currentLandmark(landmarks, [8, 9, 10])).toBe('c');
        expect(currentLandmark(landmarks, [9, 10, 11, 12])).toBe('c');
        expect(currentLandmark(landmarks, [14, 15, 16])).toBe('a');
        expect(currentLandmark(landmarks, [15, 16, 17])).toBe('a');
    });

    it('lights every landmark in turn as the reader walks up the conversation', () => {
        // The report this rule was rewritten for: with a preview_html as the second landmark from the
        // top, scrolling up never lit it — the prompt just above it shared the screen and the older of
        // the two won. Walking up must step through all four, one at a time, and never skip one.
        const lit: string[] = [];
        for (let bottom = 4; bottom <= 18; bottom++) {
            lit.push(currentLandmark(landmarks, [bottom, bottom + 1, bottom + 2])!);
        }
        expect(lit.join('')).toBe('ddccccbbbbaaaaa');
    });

    it('points at the first landmark while the reader is still above every one of them', () => {
        expect(currentLandmark(landmarks, [16, 17, 18])).toBe('a');
    });

    it('says nothing without a landmark row, or without a row measured at all', () => {
        expect(currentLandmark([], [0, 1, 2])).toBeNull();
        expect(currentLandmark(landmarks, [])).toBeNull();
    });
});
