import { AgentEvent, ImageContent } from "./typesRaw";
import { MessageMeta } from "./typesMessageMeta";

export type ToolCall = {
    callId?: string;
    name: string;
    state: 'running' | 'completed' | 'error';
    input: any;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
    description: string | null;
    result?: any;
    permission?: {
        id: string;
        status: 'pending' | 'approved' | 'denied' | 'canceled';
        reason?: string;
        mode?: string;
        allowedTools?: string[];
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
        date?: number;
        answers?: Record<string, string>;
    };
}

// Flattened message types - each message represents a single block
export type UserTextMessage = {
    kind: 'user-text';
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    text: string;
    displayText?: string; // Optional text to display in UI instead of actual text
    images?: ImageContent[]; // Optional images attached to the message
    meta?: MessageMeta;
    sentBy?: string | null;
    sentByName?: string | null;
    deliveryError?: string | null;
}

export type ModeSwitchMessage = {
    kind: 'agent-event';
    id: string;
    createdAt: number;
    seq?: number | null;
    event: AgentEvent;
    meta?: MessageMeta;
}

export type AgentTextMessage = {
    kind: 'agent-text';
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    text: string;
    isThinking?: boolean;
    meta?: MessageMeta;
}

export type ToolCallMessage = {
    kind: 'tool-call';
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    tool: ToolCall;
    children: Message[];
    meta?: MessageMeta;
}

export type Message = UserTextMessage | AgentTextMessage | ToolCallMessage | ModeSwitchMessage;

// ---------------------------------------------------------------------------
// Minimap messages
// ---------------------------------------------------------------------------

/**
 * One question inside an `AskUserQuestion` tool call. Only the text the minimap renders is kept —
 * options, descriptions and the rest of the tool payload stay in the tool call itself.
 */
export type AskUserQuestionPrompt = {
    /** Stable question id, when the producer supplied one; answers are keyed by it. */
    id?: string;
    header: string;
    question: string;
    /** Secret answers are masked, so a preview never echoes one back onto the rail. */
    isSecret?: boolean;
}

/**
 * A conversation-minimap view of an `AskUserQuestion` tool call. It carries the same identity
 * fields as any message (so the rail can key markers, dedupe them against the offline cache and
 * jump back to the row) plus the question/answer text its hover preview shows.
 */
export type AskUserQuestionMessage = {
    kind: 'ask-user-question';
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    questions: AskUserQuestionPrompt[];
    /** Chosen answers keyed by question id / question text / header. Null while unanswered. */
    answers: Record<string, string> | null;
}

/**
 * A conversation-minimap view of a `preview_html` call — the inline HTML card the list renders.
 * It carries the same identity fields as any message (so the rail can key markers, dedupe them
 * against the offline cache and jump back to the row) plus the card's title, which is all the hover
 * preview shows. The document itself stays in the tool call.
 */
export type PreviewHtmlMessage = {
    kind: 'preview-html';
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    title: string | null;
};

/** Everything the conversation minimap can place a marker for. */
export type MinimapMessage = UserTextMessage | AskUserQuestionMessage | PreviewHtmlMessage;

export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

/** True for the `AskUserQuestion` call itself — one of the two tool calls the minimap marks. */
export function isAskUserQuestionToolCall(message: Message): message is ToolCallMessage {
    return message.kind === 'tool-call' && message.tool.name === ASK_USER_QUESTION_TOOL;
}

export const PREVIEW_HTML_TOOL = 'preview_html';

/** `preview_html` in every spelling an agent produces it under. */
export function normalizePreviewHtmlToolName(name: string): string {
    return name.replace(/__/g, ':').replace(/^mcp:/, '').replace(/^happy:/, '');
}

/** True for the `preview_html` call itself — the other tool call the minimap marks. */
export function isPreviewHtmlToolCall(message: Message): message is ToolCallMessage {
    return message.kind === 'tool-call' && normalizePreviewHtmlToolName(message.tool.name) === PREVIEW_HTML_TOOL;
}

/** The inline card a `preview_html` call renders: the document, plus the title shown above it. */
export type PreviewHtmlCard = {
    html: string;
    title: string | null;
};

/**
 * Read the card out of a `preview_html` tool input. Null when the input carries no document — the
 * list then renders a plain tool row, so there is no card to show and no marker to place for it.
 */
export function readPreviewHtmlCard(input: unknown): PreviewHtmlCard | null {
    if (!input || typeof input !== 'object') return null;
    const value = input as { html?: unknown; title?: unknown };
    if (typeof value.html !== 'string' || value.html.length === 0) return null;
    return { html: value.html, title: typeof value.title === 'string' ? value.title : null };
}

/** Read the question list out of a raw `AskUserQuestion` tool input. Unparseable input yields []. */
export function parseAskUserQuestionPrompts(input: unknown): AskUserQuestionPrompt[] {
    if (!input || typeof input !== 'object') return [];
    const raw = (input as { questions?: unknown }).questions;
    if (!Array.isArray(raw)) return [];
    const prompts: AskUserQuestionPrompt[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const question = entry as { id?: unknown; header?: unknown; question?: unknown; isSecret?: unknown };
        if (typeof question.question !== 'string') continue;
        prompts.push({
            ...(typeof question.id === 'string' ? { id: question.id } : {}),
            header: typeof question.header === 'string' ? question.header : '',
            question: question.question,
            ...(question.isSecret === true ? { isSecret: true } : {}),
        });
    }
    return prompts;
}

/** Keep only the string-valued entries of an answers map; empty maps collapse to null. */
export function normalizeAskUserQuestionAnswers(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const answers: Record<string, string> = {};
    for (const [key, answer] of Object.entries(value as Record<string, unknown>)) {
        if (typeof answer === 'string' && answer) answers[key] = answer;
    }
    return Object.keys(answers).length > 0 ? answers : null;
}

/**
 * Build the minimap view of an `AskUserQuestion` call from its parts. Shared by the loaded list
 * (which has a reduced `ToolCallMessage`) and the offline cache (which decrypts raw records), so
 * both sides produce identical-looking markers. Returns null when there is nothing to show.
 */
export function buildAskUserQuestionMessage(fields: {
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    input: unknown;
    /** `permission.answers` — present when the user answered through the permission request. */
    permissionAnswers?: unknown;
    /** `tool.result` — historical/completed payloads may only carry answers here. */
    result?: unknown;
}): AskUserQuestionMessage | null {
    const questions = parseAskUserQuestionPrompts(fields.input);
    if (questions.length === 0) return null;
    const resultAnswers = fields.result && typeof fields.result === 'object'
        ? (fields.result as { answers?: unknown }).answers
        : undefined;
    return {
        kind: 'ask-user-question',
        id: fields.id,
        localId: fields.localId,
        createdAt: fields.createdAt,
        seq: fields.seq,
        questions,
        answers: normalizeAskUserQuestionAnswers(fields.permissionAnswers)
            ?? normalizeAskUserQuestionAnswers(resultAnswers),
    };
}

/** Minimap view of a loaded `AskUserQuestion` tool-call message. */
export function toAskUserQuestionMessage(message: ToolCallMessage): AskUserQuestionMessage | null {
    return buildAskUserQuestionMessage({
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        seq: message.seq,
        input: message.tool.input,
        permissionAnswers: message.tool.permission?.answers,
        result: message.tool.result,
    });
}

/**
 * Build the minimap view of a `preview_html` call from its parts. Shared by the loaded list (which
 * has a reduced `ToolCallMessage`) and the offline cache (which decrypts raw records), so both sides
 * produce identical-looking markers. Returns null while the call is still running: until its result
 * lands the list renders a plain tool row, and a marker for it would jump to no card at all.
 */
export function buildPreviewHtmlMessage(fields: {
    id: string;
    localId: string | null;
    createdAt: number;
    seq?: number | null;
    input: unknown;
    /** Whether the call already has its result — the card only exists once it does. */
    completed: boolean;
}): PreviewHtmlMessage | null {
    if (!fields.completed) return null;
    const card = readPreviewHtmlCard(fields.input);
    if (!card) return null;
    return {
        kind: 'preview-html',
        id: fields.id,
        localId: fields.localId,
        createdAt: fields.createdAt,
        seq: fields.seq,
        title: card.title,
    };
}

/** Minimap view of a loaded `preview_html` tool-call message. */
export function toPreviewHtmlMessage(message: ToolCallMessage): PreviewHtmlMessage | null {
    return buildPreviewHtmlMessage({
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        seq: message.seq,
        input: message.tool.input,
        completed: message.tool.state === 'completed',
    });
}

/** Which answer the user gave for a question: permission/result answers key by id, text or header. */
export function readAskUserQuestionAnswer(answers: Record<string, string>, question: AskUserQuestionPrompt): string | undefined {
    const answer = (question.id ? answers[question.id] : undefined) || answers[question.question] || answers[question.header];
    if (!answer) return undefined;
    // Match AskUserQuestionView: a secret answer is acknowledged, never echoed.
    return question.isSecret ? '********' : answer;
}
