export type AgentFlavor = 'claude' | 'codex' | 'gemini';

export const MODEL_MODE_DEFAULT = 'default' as const;

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type CodexModelFamily =
    | typeof MODEL_MODE_DEFAULT
    | 'gpt-5.5'
    | 'gpt-5.4'
    | 'gpt-5.4-mini'
    | 'gpt-5.3-codex'
    | 'gpt-5.2';
export type ClaudeReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ClaudeModelFamily =
    | typeof MODEL_MODE_DEFAULT
    | 'claude-fable-5'
    | 'claude-fable-5[1m]'
    | 'claude-opus-4-8'
    | 'claude-opus-4-8[1m]'
    | 'claude-opus-4-7'
    | 'claude-opus-4-7[1m]'
    | 'claude-opus-4-6'
    | 'claude-opus-4-6[1m]'
    | 'claude-sonnet-4-6'
    | 'claude-sonnet-4-6[1m]'
    | 'claude-haiku-4-5';

export const MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'claude-fable-5',
    'claude-fable-5[1m]',
    'claude-opus-4-8',
    'claude-opus-4-8[1m]',
    'claude-opus-4-7',
    'claude-opus-4-7[1m]',
    'claude-opus-4-6',
    'claude-opus-4-6[1m]',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6[1m]',
    'claude-haiku-4-5',
    'claude-fable-5-low',
    'claude-fable-5-medium',
    'claude-fable-5-high',
    'claude-fable-5-xhigh',
    'claude-fable-5-max',
    'claude-fable-5[1m]-low',
    'claude-fable-5[1m]-medium',
    'claude-fable-5[1m]-high',
    'claude-fable-5[1m]-xhigh',
    'claude-fable-5[1m]-max',
    'claude-opus-4-8-low',
    'claude-opus-4-8-medium',
    'claude-opus-4-8-high',
    'claude-opus-4-8-xhigh',
    'claude-opus-4-8-max',
    'claude-opus-4-8[1m]-low',
    'claude-opus-4-8[1m]-medium',
    'claude-opus-4-8[1m]-high',
    'claude-opus-4-8[1m]-xhigh',
    'claude-opus-4-8[1m]-max',
    'claude-opus-4-7-low',
    'claude-opus-4-7-medium',
    'claude-opus-4-7-high',
    'claude-opus-4-7-xhigh',
    'claude-opus-4-7-max',
    'claude-opus-4-7[1m]-low',
    'claude-opus-4-7[1m]-medium',
    'claude-opus-4-7[1m]-high',
    'claude-opus-4-7[1m]-xhigh',
    'claude-opus-4-7[1m]-max',
    'claude-opus-4-6-low',
    'claude-opus-4-6-medium',
    'claude-opus-4-6-high',
    'claude-opus-4-6-max',
    'claude-opus-4-6[1m]-low',
    'claude-opus-4-6[1m]-medium',
    'claude-opus-4-6[1m]-high',
    'claude-opus-4-6[1m]-max',
    'claude-sonnet-4-6-low',
    'claude-sonnet-4-6-medium',
    'claude-sonnet-4-6-high',
    'claude-sonnet-4-6-max',
    'claude-sonnet-4-6[1m]-low',
    'claude-sonnet-4-6[1m]-medium',
    'claude-sonnet-4-6[1m]-high',
    'claude-sonnet-4-6[1m]-max',
    'gpt-5.5-low',
    'gpt-5.5-medium',
    'gpt-5.5-high',
    'gpt-5.5-xhigh',
    'gpt-5.4-low',
    'gpt-5.4-medium',
    'gpt-5.4-high',
    'gpt-5.4-xhigh',
    'gpt-5.4-mini-low',
    'gpt-5.4-mini-medium',
    'gpt-5.4-mini-high',
    'gpt-5.4-mini-xhigh',
    'gpt-5.3-codex-low',
    'gpt-5.3-codex-medium',
    'gpt-5.3-codex-high',
    'gpt-5.3-codex-xhigh',
    'gpt-5.2-low',
    'gpt-5.2-medium',
    'gpt-5.2-high',
    'gpt-5.2-xhigh',
    'gemini-3.5-pro-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
] as const;

export type ModelMode = typeof MODEL_MODES[number];

export const CLAUDE_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'claude-fable-5',
    'claude-fable-5[1m]',
    'claude-opus-4-8',
    'claude-opus-4-8[1m]',
    'claude-opus-4-7',
    'claude-opus-4-7[1m]',
    'claude-opus-4-6',
    'claude-opus-4-6[1m]',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6[1m]',
    'claude-haiku-4-5',
    'claude-fable-5-low',
    'claude-fable-5-medium',
    'claude-fable-5-high',
    'claude-fable-5-xhigh',
    'claude-fable-5-max',
    'claude-fable-5[1m]-low',
    'claude-fable-5[1m]-medium',
    'claude-fable-5[1m]-high',
    'claude-fable-5[1m]-xhigh',
    'claude-fable-5[1m]-max',
    'claude-opus-4-8-low',
    'claude-opus-4-8-medium',
    'claude-opus-4-8-high',
    'claude-opus-4-8-xhigh',
    'claude-opus-4-8-max',
    'claude-opus-4-8[1m]-low',
    'claude-opus-4-8[1m]-medium',
    'claude-opus-4-8[1m]-high',
    'claude-opus-4-8[1m]-xhigh',
    'claude-opus-4-8[1m]-max',
    'claude-opus-4-7-low',
    'claude-opus-4-7-medium',
    'claude-opus-4-7-high',
    'claude-opus-4-7-xhigh',
    'claude-opus-4-7-max',
    'claude-opus-4-7[1m]-low',
    'claude-opus-4-7[1m]-medium',
    'claude-opus-4-7[1m]-high',
    'claude-opus-4-7[1m]-xhigh',
    'claude-opus-4-7[1m]-max',
    'claude-opus-4-6-low',
    'claude-opus-4-6-medium',
    'claude-opus-4-6-high',
    'claude-opus-4-6-max',
    'claude-opus-4-6[1m]-low',
    'claude-opus-4-6[1m]-medium',
    'claude-opus-4-6[1m]-high',
    'claude-opus-4-6[1m]-max',
    'claude-sonnet-4-6-low',
    'claude-sonnet-4-6-medium',
    'claude-sonnet-4-6-high',
    'claude-sonnet-4-6-max',
    'claude-sonnet-4-6[1m]-low',
    'claude-sonnet-4-6[1m]-medium',
    'claude-sonnet-4-6[1m]-high',
    'claude-sonnet-4-6[1m]-max',
] as const satisfies readonly ModelMode[];

export const GEMINI_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'gemini-3.5-pro-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
] as const satisfies readonly ModelMode[];

export const CODEX_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'gpt-5.5-low',
    'gpt-5.5-medium',
    'gpt-5.5-high',
    'gpt-5.5-xhigh',
    'gpt-5.4-low',
    'gpt-5.4-medium',
    'gpt-5.4-high',
    'gpt-5.4-xhigh',
    'gpt-5.4-mini-low',
    'gpt-5.4-mini-medium',
    'gpt-5.4-mini-high',
    'gpt-5.4-mini-xhigh',
    'gpt-5.3-codex-low',
    'gpt-5.3-codex-medium',
    'gpt-5.3-codex-high',
    'gpt-5.3-codex-xhigh',
    'gpt-5.2-low',
    'gpt-5.2-medium',
    'gpt-5.2-high',
    'gpt-5.2-xhigh',
] as const satisfies readonly ModelMode[];

const MODEL_MODE_SET = new Set<ModelMode>(MODEL_MODES);
const CLAUDE_MODEL_MODE_SET = new Set<ModelMode>(CLAUDE_MODEL_MODES);
const GEMINI_MODEL_MODE_SET = new Set<ModelMode>(GEMINI_MODEL_MODES);
const CODEX_MODEL_MODE_SET = new Set<ModelMode>(CODEX_MODEL_MODES);

export function isModelMode(value: string): value is ModelMode {
    return MODEL_MODE_SET.has(value as ModelMode);
}

export function isModelModeForAgent(agent: AgentFlavor, mode: string): mode is ModelMode {
    if (!isModelMode(mode)) return false;
    if (agent === 'claude') return CLAUDE_MODEL_MODE_SET.has(mode);
    if (agent === 'gemini') return GEMINI_MODEL_MODE_SET.has(mode);
    return CODEX_MODEL_MODE_SET.has(mode);
}

export function getValidModelModesForAgent(agent: AgentFlavor): readonly ModelMode[] {
    if (agent === 'claude') return CLAUDE_MODEL_MODES;
    if (agent === 'gemini') return GEMINI_MODEL_MODES;
    return CODEX_MODEL_MODES;
}

export const CLAUDE_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'claude-fable-5', label: 'Fable 5', shortLabel: 'Fable 5', description: 'Most powerful, most intelligent' },
    { value: 'claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus 4.8', description: 'Most capable' },
    { value: 'claude-opus-4-7', label: 'Opus 4.7', shortLabel: 'Opus 4.7', description: 'Previous generation Opus' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6', shortLabel: 'Opus 4.6', description: 'Older Opus' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', shortLabel: 'Sonnet 4.6', description: 'Balanced speed and quality' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', shortLabel: 'Haiku 4.5', description: 'Fastest' },
] as const;

export const CLAUDE_MODEL_FAMILY_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'claude-fable-5', label: 'Fable 5', shortLabel: 'Fable 5', description: 'Most powerful, most intelligent' },
    { value: 'claude-fable-5[1m]', label: 'Fable 5 (1M)', shortLabel: 'Fable 5', description: 'Most powerful, 1M context' },
    { value: 'claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus 4.8', description: 'Most capable' },
    { value: 'claude-opus-4-8[1m]', label: 'Opus 4.8 (1M)', shortLabel: 'Opus 4.8', description: 'Most capable, 1M context' },
    { value: 'claude-opus-4-7', label: 'Opus 4.7', shortLabel: 'Opus 4.7', description: 'Previous generation Opus' },
    { value: 'claude-opus-4-7[1m]', label: 'Opus 4.7 (1M)', shortLabel: 'Opus 4.7', description: 'Previous Opus, 1M context' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6', shortLabel: 'Opus 4.6', description: 'Older Opus' },
    { value: 'claude-opus-4-6[1m]', label: 'Opus 4.6 (1M)', shortLabel: 'Opus 4.6', description: 'Older Opus, 1M context' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', shortLabel: 'Sonnet 4.6', description: 'Balanced speed and quality' },
    { value: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M)', shortLabel: 'Sonnet 4.6', description: 'Balanced, 1M context' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', shortLabel: 'Haiku 4.5', description: 'Fastest' },
] as const satisfies readonly { value: ClaudeModelFamily; label: string; shortLabel: string; description: string }[];

const CLAUDE_MODE_TO_SELECTION: Partial<Record<ModelMode, { family: ClaudeModelFamily; effort: ClaudeReasoningEffort }>> = {
    'claude-fable-5-low': { family: 'claude-fable-5', effort: 'low' },
    'claude-fable-5-medium': { family: 'claude-fable-5', effort: 'medium' },
    'claude-fable-5-high': { family: 'claude-fable-5', effort: 'high' },
    'claude-fable-5-xhigh': { family: 'claude-fable-5', effort: 'xhigh' },
    'claude-fable-5-max': { family: 'claude-fable-5', effort: 'max' },
    'claude-fable-5[1m]-low': { family: 'claude-fable-5[1m]', effort: 'low' },
    'claude-fable-5[1m]-medium': { family: 'claude-fable-5[1m]', effort: 'medium' },
    'claude-fable-5[1m]-high': { family: 'claude-fable-5[1m]', effort: 'high' },
    'claude-fable-5[1m]-xhigh': { family: 'claude-fable-5[1m]', effort: 'xhigh' },
    'claude-fable-5[1m]-max': { family: 'claude-fable-5[1m]', effort: 'max' },
    'claude-opus-4-8-low': { family: 'claude-opus-4-8', effort: 'low' },
    'claude-opus-4-8-medium': { family: 'claude-opus-4-8', effort: 'medium' },
    'claude-opus-4-8-high': { family: 'claude-opus-4-8', effort: 'high' },
    'claude-opus-4-8-xhigh': { family: 'claude-opus-4-8', effort: 'xhigh' },
    'claude-opus-4-8-max': { family: 'claude-opus-4-8', effort: 'max' },
    'claude-opus-4-8[1m]-low': { family: 'claude-opus-4-8[1m]', effort: 'low' },
    'claude-opus-4-8[1m]-medium': { family: 'claude-opus-4-8[1m]', effort: 'medium' },
    'claude-opus-4-8[1m]-high': { family: 'claude-opus-4-8[1m]', effort: 'high' },
    'claude-opus-4-8[1m]-xhigh': { family: 'claude-opus-4-8[1m]', effort: 'xhigh' },
    'claude-opus-4-8[1m]-max': { family: 'claude-opus-4-8[1m]', effort: 'max' },
    'claude-opus-4-7-low': { family: 'claude-opus-4-7', effort: 'low' },
    'claude-opus-4-7-medium': { family: 'claude-opus-4-7', effort: 'medium' },
    'claude-opus-4-7-high': { family: 'claude-opus-4-7', effort: 'high' },
    'claude-opus-4-7-xhigh': { family: 'claude-opus-4-7', effort: 'xhigh' },
    'claude-opus-4-7-max': { family: 'claude-opus-4-7', effort: 'max' },
    'claude-opus-4-7[1m]-low': { family: 'claude-opus-4-7[1m]', effort: 'low' },
    'claude-opus-4-7[1m]-medium': { family: 'claude-opus-4-7[1m]', effort: 'medium' },
    'claude-opus-4-7[1m]-high': { family: 'claude-opus-4-7[1m]', effort: 'high' },
    'claude-opus-4-7[1m]-xhigh': { family: 'claude-opus-4-7[1m]', effort: 'xhigh' },
    'claude-opus-4-7[1m]-max': { family: 'claude-opus-4-7[1m]', effort: 'max' },
    'claude-opus-4-6-low': { family: 'claude-opus-4-6', effort: 'low' },
    'claude-opus-4-6-medium': { family: 'claude-opus-4-6', effort: 'medium' },
    'claude-opus-4-6-high': { family: 'claude-opus-4-6', effort: 'high' },
    'claude-opus-4-6-max': { family: 'claude-opus-4-6', effort: 'max' },
    'claude-opus-4-6[1m]-low': { family: 'claude-opus-4-6[1m]', effort: 'low' },
    'claude-opus-4-6[1m]-medium': { family: 'claude-opus-4-6[1m]', effort: 'medium' },
    'claude-opus-4-6[1m]-high': { family: 'claude-opus-4-6[1m]', effort: 'high' },
    'claude-opus-4-6[1m]-max': { family: 'claude-opus-4-6[1m]', effort: 'max' },
    'claude-sonnet-4-6-low': { family: 'claude-sonnet-4-6', effort: 'low' },
    'claude-sonnet-4-6-medium': { family: 'claude-sonnet-4-6', effort: 'medium' },
    'claude-sonnet-4-6-high': { family: 'claude-sonnet-4-6', effort: 'high' },
    'claude-sonnet-4-6-max': { family: 'claude-sonnet-4-6', effort: 'max' },
    'claude-sonnet-4-6[1m]-low': { family: 'claude-sonnet-4-6[1m]', effort: 'low' },
    'claude-sonnet-4-6[1m]-medium': { family: 'claude-sonnet-4-6[1m]', effort: 'medium' },
    'claude-sonnet-4-6[1m]-high': { family: 'claude-sonnet-4-6[1m]', effort: 'high' },
    'claude-sonnet-4-6[1m]-max': { family: 'claude-sonnet-4-6[1m]', effort: 'max' },
};

export const GEMINI_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'gemini-3.5-pro-preview', label: '3.5 Pro (Preview)', shortLabel: '3.5 Pro', description: 'Most capable' },
    { value: 'gemini-3.1-pro-preview', label: '3.1 Pro (Preview)', shortLabel: '3.1 Pro', description: 'Previous generation Pro' },
    { value: 'gemini-3.5-flash', label: '3.5 Flash', shortLabel: '3.5 Flash', description: 'Fast frontier agentic and coding model' },
    { value: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite', shortLabel: '3.1 Flash-Lite', description: 'Lightweight, optimized for speed and cost' },
    { value: 'gemini-2.5-pro', label: '2.5 Pro', shortLabel: '2.5 Pro', description: 'Previous generation' },
    { value: 'gemini-2.5-flash-lite', label: '2.5 Flash-Lite', shortLabel: '2.5 Flash-Lite', description: 'Lightweight free-tier friendly model' },
] as const;

export const CODEX_MODEL_FAMILY_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'gpt-5.5', label: 'GPT-5.5', shortLabel: '5.5', description: 'Latest, most capable' },
    { value: 'gpt-5.4', label: 'GPT-5.4', shortLabel: '5.4', description: 'General-purpose model' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', shortLabel: '5.4-Mini', description: 'Fast lightweight model' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', shortLabel: '5.3-Codex', description: 'Code-optimized model' },
    { value: 'gpt-5.2', label: 'GPT-5.2', shortLabel: '5.2', description: 'General-purpose model' },
] as const satisfies readonly { value: CodexModelFamily; label: string; shortLabel: string; description: string }[];

export const CODEX_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Default', description: 'Use CLI default model' },
    { value: 'gpt-5.5-low', label: 'GPT-5.5 (Low)', description: 'Fast responses' },
    { value: 'gpt-5.5-medium', label: 'GPT-5.5 (Medium)', description: 'Balanced responses' },
    { value: 'gpt-5.5-high', label: 'GPT-5.5 (High)', description: 'Strong quality' },
    { value: 'gpt-5.5-xhigh', label: 'GPT-5.5 (XHigh)', description: 'Best quality' },
    { value: 'gpt-5.4-low', label: 'GPT-5.4 (Low)', description: 'Fast responses' },
    { value: 'gpt-5.4-medium', label: 'GPT-5.4 (Medium)', description: 'Balanced responses' },
    { value: 'gpt-5.4-high', label: 'GPT-5.4 (High)', description: 'Strong quality' },
    { value: 'gpt-5.4-xhigh', label: 'GPT-5.4 (XHigh)', description: 'Best quality' },
    { value: 'gpt-5.4-mini-low', label: 'GPT-5.4-Mini (Low)', description: 'Fastest responses' },
    { value: 'gpt-5.4-mini-medium', label: 'GPT-5.4-Mini (Medium)', description: 'Balanced speed and quality' },
    { value: 'gpt-5.4-mini-high', label: 'GPT-5.4-Mini (High)', description: 'Higher quality with good speed' },
    { value: 'gpt-5.4-mini-xhigh', label: 'GPT-5.4-Mini (XHigh)', description: 'Best quality' },
    { value: 'gpt-5.3-codex-low', label: 'GPT-5.3-Codex (Low)', description: 'Fastest coding responses' },
    { value: 'gpt-5.3-codex-medium', label: 'GPT-5.3-Codex (Medium)', description: 'Balanced coding quality' },
    { value: 'gpt-5.3-codex-high', label: 'GPT-5.3-Codex (High)', description: 'Strong coding quality' },
    { value: 'gpt-5.3-codex-xhigh', label: 'GPT-5.3-Codex (XHigh)', description: 'Best coding quality' },
    { value: 'gpt-5.2-low', label: 'GPT-5.2 (Low)', description: 'Fast responses' },
    { value: 'gpt-5.2-medium', label: 'GPT-5.2 (Medium)', description: 'Balanced responses' },
    { value: 'gpt-5.2-high', label: 'GPT-5.2 (High)', description: 'Strong quality' },
    { value: 'gpt-5.2-xhigh', label: 'GPT-5.2 (XHigh)', description: 'Best quality' },
] as const satisfies readonly { value: ModelMode; label: string; description: string }[];

const CODEX_MODE_TO_SELECTION: Partial<Record<ModelMode, { family: CodexModelFamily; effort: CodexReasoningEffort }>> = {
    'gpt-5.5-low': { family: 'gpt-5.5', effort: 'low' },
    'gpt-5.5-medium': { family: 'gpt-5.5', effort: 'medium' },
    'gpt-5.5-high': { family: 'gpt-5.5', effort: 'high' },
    'gpt-5.5-xhigh': { family: 'gpt-5.5', effort: 'xhigh' },
    'gpt-5.4-low': { family: 'gpt-5.4', effort: 'low' },
    'gpt-5.4-medium': { family: 'gpt-5.4', effort: 'medium' },
    'gpt-5.4-high': { family: 'gpt-5.4', effort: 'high' },
    'gpt-5.4-xhigh': { family: 'gpt-5.4', effort: 'xhigh' },
    'gpt-5.4-mini-low': { family: 'gpt-5.4-mini', effort: 'low' },
    'gpt-5.4-mini-medium': { family: 'gpt-5.4-mini', effort: 'medium' },
    'gpt-5.4-mini-high': { family: 'gpt-5.4-mini', effort: 'high' },
    'gpt-5.4-mini-xhigh': { family: 'gpt-5.4-mini', effort: 'xhigh' },
    'gpt-5.3-codex-low': { family: 'gpt-5.3-codex', effort: 'low' },
    'gpt-5.3-codex-medium': { family: 'gpt-5.3-codex', effort: 'medium' },
    'gpt-5.3-codex-high': { family: 'gpt-5.3-codex', effort: 'high' },
    'gpt-5.3-codex-xhigh': { family: 'gpt-5.3-codex', effort: 'xhigh' },
    'gpt-5.2-low': { family: 'gpt-5.2', effort: 'low' },
    'gpt-5.2-medium': { family: 'gpt-5.2', effort: 'medium' },
    'gpt-5.2-high': { family: 'gpt-5.2', effort: 'high' },
    'gpt-5.2-xhigh': { family: 'gpt-5.2', effort: 'xhigh' },
};

export function parseClaudeModelMode(mode: ModelMode): { family: ClaudeModelFamily; effort: ClaudeReasoningEffort | null } {
    const entry = CLAUDE_MODE_TO_SELECTION[mode];
    if (entry) return entry;
    if (mode === MODEL_MODE_DEFAULT) return { family: MODEL_MODE_DEFAULT, effort: null };
    return { family: mode as ClaudeModelFamily, effort: null };
}

export function getClaudeReasoningOptions(family: ClaudeModelFamily): readonly ClaudeReasoningEffort[] {
    if (family === 'claude-fable-5' || family === 'claude-fable-5[1m]'
        || family === 'claude-opus-4-8' || family === 'claude-opus-4-8[1m]'
        || family === 'claude-opus-4-7' || family === 'claude-opus-4-7[1m]') return ['max', 'xhigh', 'high', 'medium', 'low'];
    if (family === 'claude-opus-4-6' || family === 'claude-opus-4-6[1m]'
        || family === 'claude-sonnet-4-6' || family === 'claude-sonnet-4-6[1m]') return ['max', 'high', 'medium', 'low'];
    if (family === 'claude-haiku-4-5') return [];
    return ['high', 'medium', 'low'];
}

export function claudeSupportsFastMode(family: ClaudeModelFamily): boolean {
    return family === 'claude-opus-4-8' || family === 'claude-opus-4-8[1m]'
        || family === 'claude-opus-4-7' || family === 'claude-opus-4-7[1m]'
        || family === 'claude-opus-4-6' || family === 'claude-opus-4-6[1m]';
}

export function buildClaudeModelMode(
    family: ClaudeModelFamily,
    effort: ClaudeReasoningEffort,
): ModelMode {
    if (family === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    // Haiku 4.5 does not support effort levels — always use the base model mode.
    if (family === 'claude-haiku-4-5') return 'claude-haiku-4-5';
    return `${family}-${effort}` as ModelMode;
}

export function parseCodexModelMode(mode: ModelMode): { family: CodexModelFamily; effort: CodexReasoningEffort } {
    return CODEX_MODE_TO_SELECTION[mode] ?? { family: MODEL_MODE_DEFAULT, effort: 'medium' };
}

export function getCodexReasoningOptions(family: CodexModelFamily): readonly CodexReasoningEffort[] {
    if (family === MODEL_MODE_DEFAULT) return ['high', 'medium', 'low'];
    return ['xhigh', 'high', 'medium', 'low'];
}

export function buildCodexModelMode(
    family: CodexModelFamily,
    effort: CodexReasoningEffort,
): ModelMode {
    if (family === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    return `${family}-${effort}` as ModelMode;
}

export type ModelSelection = {
    model: string | null;
    reasoningEffort: string | null;
};

const MODEL_NAME_LABELS: Record<string, string> = {
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4-Mini',
    'gpt-5.3-codex': 'GPT-5.3-Codex',
    'gpt-5.2': 'GPT-5.2',
    'claude-fable-5': 'Claude Fable 5',
    'claude-opus-4-8': 'Claude Opus 4.8',
    'claude-opus-4-7': 'Claude Opus 4.7',
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'gemini-3.5-pro-preview': 'Gemini 3.5 Pro (Preview)',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (Preview)',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
};

const REASONING_EFFORT_LABELS: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    max: 'Max',
    xhigh: 'XHigh',
};

export function resolveModelSelectionForFlavor(flavor: string | null | undefined, modelMode: string): ModelSelection {
    if (modelMode === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null };
    if (!isModelMode(modelMode)) return { model: modelMode, reasoningEffort: null };
    if (flavor === 'codex') {
        const parsed = parseCodexModelMode(modelMode);
        if (parsed.family === MODEL_MODE_DEFAULT) return { model: modelMode, reasoningEffort: null };
        return { model: parsed.family, reasoningEffort: parsed.effort };
    }
    if (flavor === 'claude') {
        const parsed = parseClaudeModelMode(modelMode);
        if (parsed.family === MODEL_MODE_DEFAULT) return { model: modelMode, reasoningEffort: null };
        return { model: parsed.family, reasoningEffort: parsed.effort };
    }
    if (flavor === 'gemini') return { model: modelMode, reasoningEffort: null };
    return { model: null, reasoningEffort: null };
}

export function resolveLocalModelDisplay(modelMode: string | null | undefined): ModelSelection {
    if (!modelMode || modelMode === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null };
    if (!isModelMode(modelMode)) return { model: modelMode, reasoningEffort: null };

    const parsedCodex = parseCodexModelMode(modelMode);
    if (parsedCodex.family !== MODEL_MODE_DEFAULT) {
        return { model: parsedCodex.family, reasoningEffort: parsedCodex.effort };
    }

    const parsedClaude = CLAUDE_MODE_TO_SELECTION[modelMode as ModelMode];
    if (parsedClaude) {
        return { model: parsedClaude.family, reasoningEffort: parsedClaude.effort };
    }

    return { model: modelMode, reasoningEffort: null };
}

/** Strip date suffix (YYYYMMDD / YYYY-MM-DD) and -fast suffix to get the canonical model key. */
function normalizeModelId(model: string): string {
    return model.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-fast$/, '');
}

export function formatModelNameLabel(model: string | null | undefined): string | null {
    if (!model) return null;
    if (MODEL_NAME_LABELS[model]) return MODEL_NAME_LABELS[model];
    if (isModelMode(model)) {
        const codexParsed = parseCodexModelMode(model);
        if (codexParsed.family !== MODEL_MODE_DEFAULT) {
            return MODEL_NAME_LABELS[codexParsed.family] ?? codexParsed.family;
        }
    }
    const stripped = normalizeModelId(model);
    if (stripped !== model && MODEL_NAME_LABELS[stripped]) return MODEL_NAME_LABELS[stripped];
    return model;
}

export function formatReasoningEffortLabel(effort: string | null | undefined): string | null {
    if (!effort) return null;
    return REASONING_EFFORT_LABELS[effort] ?? effort;
}

export const FAST_MODE_ICON_COLOR = '#F5A623';

export function isModelFast(model: string | null | undefined): boolean {
    return typeof model === 'string' && /-fast(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model);
}

export function formatModelDisplay(model: string | null | undefined, reasoningEffort: string | null | undefined): string | null {
    const is1m = typeof model === 'string' && model.includes('[1m]');
    const modelLabel = formatModelNameLabel(is1m ? model!.replace(/\[1m\]/g, '') : model);
    if (!modelLabel) return null;
    const effortLabel = formatReasoningEffortLabel(reasoningEffort);
    const parts = [is1m ? '1M' : '', effortLabel ?? ''].filter(Boolean);
    return parts.length > 0 ? `${modelLabel} (${parts.join(', ')})` : modelLabel;
}

// ─── Context Window Sizes ──────────────────────────────────────

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;

const AGENT_DEFAULT_CONTEXT_WINDOWS: Record<AgentFlavor, number> = {
    claude: 200_000,
    codex: 258_400,
    gemini: 1_000_000,
};

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // Claude models (default 200K; 1M is opt-in via [1m] suffix in Claude Code)
    'claude-fable-5': 1_000_000, // Fable 5 defaults to 1M; base name resolves to 1M
    'claude-fable-5[1m]': 1_000_000,
    'claude-opus-4-8': 1_000_000, // 4.8 defaults to 1M (no opt-in needed); base name resolves to 1M
    'claude-opus-4-8[1m]': 1_000_000,
    'claude-opus-4-7': 200_000,
    'claude-opus-4-7[1m]': 1_000_000,
    'claude-opus-4-6': 200_000,
    'claude-opus-4-6[1m]': 1_000_000,
    'claude-sonnet-4-6': 200_000,
    'claude-sonnet-4-6[1m]': 1_000_000,
    'claude-haiku-4-5': 200_000,
    // Codex models (fallback; actual value comes from CLI via context_window_size)
    'gpt-5.5': 258_400,
    'gpt-5.4': 258_400,
    'gpt-5.4-mini': 258_400,
    'gpt-5.3-codex': 258_400,
    'gpt-5.2': 258_400,
    // Gemini models
    'gemini-3.5-pro-preview': 1_000_000,
    'gemini-3.1-pro-preview': 1_000_000,
    'gemini-3.5-flash': 1_000_000,
    'gemini-3.1-flash-lite': 1_000_000,
    'gemini-2.5-pro': 1_000_000,
    'gemini-2.5-flash-lite': 1_000_000,
};

/**
 * Get the max context window size for a given model mode and agent flavor.
 * Falls back to agent default, then global default.
 */
function findContextWindow(model: string): number | undefined {
    if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
    const stripped = normalizeModelId(model);
    if (stripped !== model && MODEL_CONTEXT_WINDOWS[stripped]) return MODEL_CONTEXT_WINDOWS[stripped];
    return undefined;
}

export function getMaxContextSize(
    modelMode: string | null | undefined,
    agentFlavor: AgentFlavor | string | null | undefined,
    actualModel?: string | null,
    actualContextSize?: number | null,
): number {
    const window = computeMaxContextSize(modelMode, agentFlavor, actualModel);
    // Defensive fallback: a window can't hold more tokens than its size. If the
    // session's actual usage already exceeds the computed window, the session is
    // really on the extended (1M) window — surface that so the usage bar doesn't
    // overflow (e.g. a 1M session whose modelMode is "default" and whose reported
    // model lacks the [1m] suffix, with no CLI-reported contextWindowSize).
    if (actualContextSize && actualContextSize > window) {
        return EXTENDED_CONTEXT_WINDOW;
    }
    return window;
}

function computeMaxContextSize(modelMode: string | null | undefined, agentFlavor: AgentFlavor | string | null | undefined, actualModel?: string | null): number {
    // When modelMode is "default" (CLI configured), use the actual model reported by CLI if available
    if ((!modelMode || modelMode === MODEL_MODE_DEFAULT) && actualModel) {
        const found = findContextWindow(actualModel);
        if (found) return found;
    }

    // Try exact model mode match (for composite codex modes, extract family)
    if (modelMode && modelMode !== MODEL_MODE_DEFAULT) {
        if (MODEL_CONTEXT_WINDOWS[modelMode]) return MODEL_CONTEXT_WINDOWS[modelMode];

        // Strip -fast suffix for lookups
        const stripped = modelMode.replace(/-fast$/, '');
        if (stripped !== modelMode && MODEL_CONTEXT_WINDOWS[stripped]) return MODEL_CONTEXT_WINDOWS[stripped];

        // For codex composite modes like "gpt-5.3-codex-high", extract family
        if (isModelMode(modelMode)) {
            const parsed = parseCodexModelMode(modelMode);
            if (parsed.family !== MODEL_MODE_DEFAULT && MODEL_CONTEXT_WINDOWS[parsed.family]) {
                return MODEL_CONTEXT_WINDOWS[parsed.family];
            }
        }

        // For claude composite modes like "claude-opus-4-6-high", extract family
        const claudeMode = isModelMode(modelMode) ? modelMode : (isModelMode(stripped) ? stripped : null);
        if (claudeMode) {
            const parsedClaude = parseClaudeModelMode(claudeMode);
            if (parsedClaude.family !== MODEL_MODE_DEFAULT && MODEL_CONTEXT_WINDOWS[parsedClaude.family]) {
                return MODEL_CONTEXT_WINDOWS[parsedClaude.family];
            }
        }
    }
    // Fall back to agent default
    if (agentFlavor && agentFlavor in AGENT_DEFAULT_CONTEXT_WINDOWS) {
        return AGENT_DEFAULT_CONTEXT_WINDOWS[agentFlavor as AgentFlavor];
    }
    return DEFAULT_CONTEXT_WINDOW;
}
