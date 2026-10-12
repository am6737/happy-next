import os from 'node:os';
import { query } from '@/claude/sdk/query';
import type { SDKMessage } from '@/claude/sdk/types';
import {
    TEAMMATE_HANDLE_REGEX, TeammateDraftSchema,
    type TeammateDraft, type TeammateDraftQuestion, type TeammateDraftRequest,
} from 'happy-wire';

// Mirrors AVATAR_COLORS in happy-app's TeammateFormFields so a drafted color is one the picker shows.
const AVATAR_COLORS = ['#5B6EF5', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#64748B'];
const DRAFT_TIMEOUT_MS = 100_000;
const MAX_QUESTIONS = 3;
const MAX_SUGGESTIONS = 4;
// Drafting is pure text generation. A print-mode run cannot prompt for permission, but read-only
// tools need none, so every built-in is disallowed by name and user MCP servers are not loaded.
export const DISALLOWED_TOOLS = [
    'Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS',
    'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'ExitPlanMode', 'SlashCommand', 'Skill',
];

export type TeammateDraftResult = { draft: TeammateDraft; questions: TeammateDraftQuestion[] };

type QueryFn = typeof query;

const SYSTEM_PROMPT = [
    'You help a user design an "Agent": an autonomous AI teammate that works on their machine and code repositories.',
    'Act like a thoughtful interviewer. Each round, return the best draft you can from what you know, plus up to 3 clarifying',
    'questions about what matters most and is still ambiguous: which repositories it owns, how autonomous it is versus asking first,',
    'what triggers its work and how often, how it reports back, and what it must never do.',
    'Every question has 2-4 short, concrete suggested answers the user can tap. Never re-ask something already answered.',
    'Ask fewer questions as the picture gets clearer, and return an empty questions array once nothing important remains',
    '(usually after 2-3 rounds or 6+ answers).',
    '',
    'Reply with ONE short sentence, then exactly one block:',
    '<teammate_draft>{"draft":{"name":"","handle":"","role":"","instructions":"","avatar":{"emoji":"","color":""}},"questions":[{"question":"","suggestions":[""]}]}</teammate_draft>',
    '',
    'Draft rules:',
    '- name: human-friendly, at most 40 characters.',
    '- handle: lowercase ASCII a-z, 0-9, "_" or "-", 2-32 characters, starting with a letter or digit.',
    '- role: one sentence, at most 120 characters.',
    '- instructions: a Markdown working guide in second person, 150-400 words, covering mission, responsibilities,',
    '  how to work, boundaries (what not to do) and how to report.',
    `- avatar.emoji: a single emoji. avatar.color: one of ${AVATAR_COLORS.join(' ')}.`,
    'Write name, role, instructions, questions and suggestions in the requested locale; the handle stays ASCII.',
    'Do not use any tools.',
].join('\n');

export function buildTeammateDraftPrompt(request: TeammateDraftRequest): { systemPrompt: string; userPrompt: string } {
    const parts = [`Description of the Agent:\n${request.description}`];
    if (request.locale) {
        parts.push(`Locale: ${request.locale}`);
    }
    if (request.answers?.length) {
        const history = request.answers.map((item, index) => `${index + 1}. Q: ${item.question}\n   A: ${item.answer}`);
        parts.push(`Answers so far:\n${history.join('\n')}`);
    }
    if (request.previous) {
        parts.push(`Current draft (keep fields the answers and feedback do not affect):\n${JSON.stringify(request.previous)}`);
    }
    if (request.feedback) {
        parts.push(`Revise the draft according to this feedback:\n${request.feedback}`);
    }
    return { systemPrompt: SYSTEM_PROMPT, userPrompt: parts.join('\n\n') };
}

/** Escapes raw newlines/tabs inside JSON strings, which CLI-backed models emit in long Markdown values. */
function escapeControlCharsInStrings(value: string): string {
    let result = '';
    let inString = false;
    let escaped = false;
    for (const char of value) {
        if (inString && !escaped && char === '\n') {
            result += '\\n';
        } else if (inString && !escaped && char === '\r') {
            result += '\\r';
        } else if (inString && !escaped && char === '\t') {
            result += '\\t';
        } else {
            result += char;
        }
        if (char === '"' && !escaped) {
            inString = !inString;
        }
        escaped = inString && char === '\\' && !escaped;
    }
    return result;
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        try {
            return JSON.parse(escapeControlCharsInStrings(value));
        } catch {
            return undefined;
        }
    }
}

/** The last tagged block wins; fenced JSON or a bare object are fallbacks for models that drop the tags. */
function extractPayload(text: string): string | undefined {
    const tagged = [...text.matchAll(/<teammate_draft>([\s\S]*?)<\/teammate_draft>/gi)];
    if (tagged.length) {
        return tagged[tagged.length - 1][1];
    }
    const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    if (fenced.length) {
        return fenced[fenced.length - 1][1];
    }
    return text.match(/\{[\s\S]*\}/)?.[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uniqueTexts(value: unknown, max: number, limit: number): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of value) {
        const entry = text(item, max);
        if (!entry || seen.has(entry.toLowerCase())) {
            continue;
        }
        seen.add(entry.toLowerCase());
        result.push(entry);
        if (result.length === limit) {
            break;
        }
    }
    return result;
}

function toHandle(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 32).replace(/[-_]+$/, '');
}

function sanitizeDraft(source: Record<string, unknown>): TeammateDraft | null {
    const name = text(source.name, 64);
    const role = text(source.role, 200);
    const instructions = text(source.instructions, 20000);
    if (!name && !role && !instructions) {
        return null;
    }
    const handle = [text(source.handle, 64), name].map(toHandle).find(candidate => TEAMMATE_HANDLE_REGEX.test(candidate)) ?? 'agent';
    const avatar = isRecord(source.avatar) ? source.avatar : {};
    const emoji = text(avatar.emoji, 16);
    const color = text(avatar.color, 32);
    const parsed = TeammateDraftSchema.safeParse({
        name,
        handle,
        role,
        skills: [],
        instructions,
        avatar: {
            emoji: emoji || undefined,
            color: /^#[0-9a-f]{6}$/i.test(color) ? color : undefined,
        },
    });
    return parsed.success ? parsed.data : null;
}

function sanitizeQuestions(value: unknown): TeammateDraftQuestion[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter(isRecord)
        .map(item => ({ question: text(item.question, 300), suggestions: uniqueTexts(item.suggestions, 120, MAX_SUGGESTIONS) }))
        .filter(item => item.question)
        .slice(0, MAX_QUESTIONS);
}

export function parseTeammateDraftResult(output: string): TeammateDraftResult | null {
    const payload = extractPayload(output);
    const value = payload === undefined ? undefined : parseJson(payload.trim());
    if (!isRecord(value)) {
        return null;
    }
    // Older replies carry the bare draft object without questions.
    const draft = sanitizeDraft(isRecord(value.draft) ? value.draft : value);
    return draft ? { draft, questions: sanitizeQuestions(value.questions) } : null;
}

function assistantText(message: SDKMessage): string {
    if (message.type !== 'assistant') {
        return '';
    }
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('');
}

/** Runs one tool-less Claude turn on this machine and turns its reply into a draft plus follow-up questions. */
export async function generateTeammateDraft(request: TeammateDraftRequest, deps: { query?: QueryFn } = {}): Promise<TeammateDraftResult> {
    const { systemPrompt, userPrompt } = buildTeammateDraftPrompt(request);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
        const run = (deps.query ?? query)({
            prompt: userPrompt,
            options: {
                customSystemPrompt: systemPrompt,
                maxTurns: 1,
                model: request.model,
                cwd: os.tmpdir(),
                abort: controller.signal,
                disallowedTools: DISALLOWED_TOOLS,
                strictMcpConfig: true,
            },
        });
        let output = '';
        let finalText = '';
        for await (const message of run) {
            output += assistantText(message);
            if (message.type === 'result') {
                const result = message as { is_error?: boolean; result?: unknown };
                if (result.is_error) {
                    throw new Error(typeof result.result === 'string' && result.result ? result.result : 'Claude could not draft the Agent');
                }
                finalText = typeof result.result === 'string' ? result.result : '';
            }
        }
        const parsed = parseTeammateDraftResult(output) ?? parseTeammateDraftResult(finalText);
        if (!parsed) {
            throw new Error('Claude returned a draft that could not be read; try again');
        }
        return parsed;
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error('Drafting timed out; try again');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
