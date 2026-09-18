import { describe, expect, it } from 'vitest';
import { shouldHideMessageInMinimap, shouldHideMessageInChatList } from './chatListVisibility';
import { AgentTextMessage, MinimapMessage, UserTextMessage } from '@/sync/typesMessage';

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
