import type { ModelCatalog, ModelCatalogEntry, ModelPricing, ReasoningEffort } from '../modelCatalogSchema';

/**
 * Daily model catalog sync — the pure part.
 *
 * Merges what the upstream sources report into the catalog and describes every
 * change for the pull request. The Codex CLI version (`codexCli`) is never
 * touched: it is updated by hand only.
 *
 * - Codex (`model/list` of the pinned Codex CLI) is authoritative: labels,
 *   descriptions, efforts and order follow it, models it no longer lists are
 *   retired, and new ones are added.
 * - Claude (basellm/llm-metadata): prices, fast-mode prices and efforts follow
 *   upstream. A model newer than the newest catalog model of its family (e.g.
 *   `claude-opus-5-5` after `claude-opus-5`) is added, copying the sibling's
 *   description for review. Context windows of existing models are left alone,
 *   because the catalog's 1M opt-in (`[1m]`) is a Claude Code concept the API
 *   doesn't know; dropped fast mode and deprecation are only reported.
 * - Gemini is report-only: models Gemini CLI knows but the catalog doesn't are
 *   listed for a human to decide.
 *
 * A source that failed is passed as null and leaves its part of the catalog as is.
 */

export type CodexUpstreamModel = {
    id: string;
    displayName: string;
    description: string;
    /** Weakest first, as Codex reports them. */
    efforts: string[];
};

export type ClaudeUpstreamModel = {
    id: string;
    /** Official name, e.g. `Claude Opus 5.5`. */
    name?: string;
    contextWindow?: number;
    /** Strongest first; undefined when upstream doesn't say. */
    efforts?: ReasoningEffort[];
    pricing?: ModelPricing;
    /** Fast mode rates; present only for models that offer fast mode. */
    fastPricing?: ModelPricing;
    deprecated?: boolean;
};

export type UpstreamModels = {
    codex: CodexUpstreamModel[] | null;
    claude: ClaudeUpstreamModel[] | null;
    gemini: string[] | null;
};

export type SyncReport = {
    added: string[];
    retired: string[];
    updated: string[];
    /** Things a reviewer must check before merging. */
    review: string[];
    geminiCandidates: string[];
};

const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const DEFAULT_CODEX_CONTEXT_WINDOW = 272_000;
const CLAUDE_FAMILY_ID = /^claude-(fable|opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?$/;

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function isReasoningEffort(value: string): value is ReasoningEffort {
    return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** Parse `claude-opus-5-5` into its family and a comparable version. */
function claudeVersion(id: string): { family: string; version: number; label: string } | null {
    const match = CLAUDE_FAMILY_ID.exec(id);
    if (!match) return null;
    const [, family, major, minor] = match;
    const name = family.charAt(0).toUpperCase() + family.slice(1);
    return {
        family,
        version: Number(major) * 100 + Number(minor ?? 0),
        label: minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`,
    };
}

function syncCodex(models: ModelCatalogEntry[], upstream: CodexUpstreamModel[], report: SyncReport): ModelCatalogEntry[] {
    const catalogCodex = models.filter((model) => model.agent === 'codex');
    const byId = new Map(catalogCodex.map((model) => [model.id, model]));
    const active: ModelCatalogEntry[] = [];

    for (const up of upstream) {
        const efforts = up.efforts.filter(isReasoningEffort).reverse();
        const unknown = up.efforts.filter((effort) => !isReasoningEffort(effort));
        if (unknown.length > 0) report.review.push(`\`${up.id}\` reports unknown efforts ${unknown.join(', ')} — extend ReasoningEffortSchema to offer them.`);
        const shortLabel = up.displayName.replace(/^GPT-/, '');
        const existing = byId.get(up.id);

        if (!existing) {
            // Borrow the context window from the same generation (gpt-6-sol ← gpt-6-astra), else the
            // same tier (gpt-6-sol ← gpt-5.6-sol): generations share a window more reliably than tiers.
            const generation = up.id.split('-').slice(0, 2).join('-');
            const tier = up.id.split('-').pop();
            const known = [...active, ...catalogCodex];
            const sibling = known.find((model) => model.id !== up.id && model.id.startsWith(`${generation}-`))
                ?? known.find((model) => model.id.split('-').pop() === tier)
                ?? known[0];
            const contextWindow = sibling?.contextWindow ?? DEFAULT_CODEX_CONTEXT_WINDOW;
            active.push({
                id: up.id,
                agent: 'codex',
                status: 'active',
                label: up.displayName,
                shortLabel,
                displayName: up.displayName,
                description: up.description,
                efforts,
                contextWindow,
            });
            report.added.push(`Codex \`${up.id}\` (${up.displayName}): efforts ${efforts.join(', ')}`);
            report.review.push(`\`${up.id}\` context window ${contextWindow.toLocaleString('en-US')} is borrowed from ${sibling ? `\`${sibling.id}\`` : 'the default'} — Codex does not report it.`);
            continue;
        }

        const next: ModelCatalogEntry = { ...existing, status: 'active', label: up.displayName, shortLabel, displayName: up.displayName, description: up.description, efforts };
        if (next.effortDescriptions) {
            const kept = Object.fromEntries(Object.entries(next.effortDescriptions).filter(([effort]) => efforts.includes(effort as ReasoningEffort)));
            next.effortDescriptions = Object.keys(kept).length > 0 ? kept : undefined;
        }
        if (existing.status === 'retired') report.added.push(`Codex \`${up.id}\` is listed again and was reactivated`);
        for (const field of ['label', 'shortLabel', 'description', 'efforts'] as const) {
            if (!sameJson(existing[field], next[field])) {
                report.updated.push(`Codex \`${up.id}\` ${field}: ${JSON.stringify(existing[field])} → ${JSON.stringify(next[field])}`);
            }
        }
        active.push(next);
    }

    const upstreamIds = new Set(upstream.map((up) => up.id));
    const retired = catalogCodex
        .filter((model) => !upstreamIds.has(model.id))
        .map((model) => {
            if (model.status === 'active') report.retired.push(`Codex \`${model.id}\` is no longer offered by the Codex CLI`);
            return { ...model, status: 'retired' as const };
        });

    // Codex models keep their block in the list, reordered to match Codex's own order.
    const start = models.findIndex((model) => model.agent === 'codex');
    const others = models.filter((model) => model.agent !== 'codex');
    const insertAt = start === -1 ? others.length : models.slice(0, start).filter((model) => model.agent !== 'codex').length;
    return [...others.slice(0, insertAt), ...active, ...retired, ...others.slice(insertAt)];
}

function syncClaude(models: ModelCatalogEntry[], upstream: ClaudeUpstreamModel[], report: SyncReport): ModelCatalogEntry[] {
    const byId = new Map(upstream.map((up) => [up.id, up]));
    let next = models.map((model) => {
        const up = model.agent === 'claude' ? byId.get(model.id) : undefined;
        if (!up) return model;
        const updated = { ...model };
        if (up.pricing && !sameJson(model.pricing, up.pricing)) {
            updated.pricing = up.pricing;
            report.updated.push(`Claude \`${model.id}\` pricing: ${JSON.stringify(model.pricing ?? null)} → ${JSON.stringify(up.pricing)}`);
        }
        if (up.efforts && !sameJson(model.efforts, up.efforts)) {
            updated.efforts = up.efforts;
            report.updated.push(`Claude \`${model.id}\` efforts: ${model.efforts.join(', ') || 'none'} → ${up.efforts.join(', ') || 'none'}`);
        }
        if (up.fastPricing && (!model.fastMode || !sameJson(model.fastPricing, up.fastPricing))) {
            updated.fastMode = true;
            updated.fastPricing = up.fastPricing;
            report.updated.push(`Claude \`${model.id}\` fast mode pricing: ${JSON.stringify(model.fastPricing ?? null)} → ${JSON.stringify(up.fastPricing)}`);
        }
        if (!up.fastPricing && up.pricing && model.fastMode) {
            report.review.push(`\`${model.id}\`: upstream no longer lists fast mode — remove \`fastMode\`/\`fastPricing\` if it was withdrawn.`);
        }
        if (up.deprecated && model.status === 'active') {
            report.review.push(`\`${model.id}\` is deprecated upstream — consider retiring it or updating its description.`);
        }
        return updated;
    });

    const candidates = upstream
        .filter((up) => !next.some((model) => model.id === up.id))
        .map((up) => ({ up, parsed: claudeVersion(up.id) }))
        .filter((candidate): candidate is { up: ClaudeUpstreamModel; parsed: NonNullable<ReturnType<typeof claudeVersion>> } => candidate.parsed !== null)
        .sort((a, b) => a.parsed.version - b.parsed.version);

    for (const { up, parsed } of candidates) {
        const newest = next
            .filter((model) => model.agent === 'claude' && model.status === 'active' && claudeVersion(model.id)?.family === parsed.family)
            .sort((a, b) => claudeVersion(b.id)!.version - claudeVersion(a.id)!.version)[0];
        // Only successors: older or unknown families were left out of the catalog on purpose.
        if (!newest || parsed.version <= claudeVersion(newest.id)!.version) continue;

        const contextWindow = up.contextWindow ?? newest.contextWindow;
        const label = up.name?.replace(/^Claude /, '') ?? parsed.label;
        const entry: ModelCatalogEntry = {
            id: up.id,
            agent: 'claude',
            status: 'active',
            label,
            displayName: `Claude ${label}`,
            description: newest.description,
            efforts: up.efforts ?? newest.efforts,
            contextWindow,
            ...(contextWindow >= 1_000_000 ? { context1m: 'always' as const } : {}),
            ...(up.fastPricing ? { fastMode: true } : {}),
            ...(up.pricing ? { pricing: up.pricing } : {}),
            ...(up.fastPricing ? { fastPricing: up.fastPricing } : {}),
        };
        next = next.flatMap((model) => (model === newest ? [entry, model] : [model]));
        report.added.push(`Claude \`${up.id}\` (${entry.displayName}), based on \`${newest.id}\``);
        report.review.push(`\`${up.id}\`: description copied from \`${newest.id}\` ("${newest.description}"); update both, e.g. mark \`${newest.id}\` as previous generation.`);
        if (!up.efforts) report.review.push(`\`${up.id}\`: upstream lists no efforts; copied from \`${newest.id}\` (${newest.efforts.join(', ')}).`);
        if (!up.pricing) report.review.push(`\`${up.id}\`: no upstream pricing — add \`pricing\` or its cost reads as the default model's.`);
    }
    return next;
}

function findGeminiCandidates(models: ModelCatalogEntry[], upstream: string[]): string[] {
    const known = new Set(models.filter((model) => model.agent === 'gemini').map((model) => model.id));
    return upstream.filter((id) => /^gemini-\d/.test(id) && !id.endsWith('-customtools') && !known.has(id));
}

export function syncCatalog(catalog: ModelCatalog, upstream: UpstreamModels): { catalog: ModelCatalog; report: SyncReport } {
    const report: SyncReport = { added: [], retired: [], updated: [], review: [], geminiCandidates: [] };
    let models = catalog.models;
    if (upstream.codex) models = syncCodex(models, upstream.codex, report);
    if (upstream.claude) models = syncClaude(models, upstream.claude, report);
    if (upstream.gemini) report.geminiCandidates = findGeminiCandidates(models, upstream.gemini);
    return { catalog: { ...catalog, models }, report };
}

/** True when the sync produced anything worth a pull request. */
export function hasCatalogChanges(report: SyncReport): boolean {
    return report.added.length + report.retired.length + report.updated.length > 0;
}

/**
 * Serialize like the hand-written file: 4-space indent, with arrays of plain
 * values and all-number objects (prices) on one line, so a sync only diffs
 * the lines it changes.
 */
export function formatCatalogJson(catalog: ModelCatalog): string {
    const inline = (value: unknown) =>
        (Array.isArray(value) && value.every((item) => typeof item !== 'object'))
        || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'number'));
    const format = (value: unknown, indent: string): string => {
        if (inline(value)) {
            if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
            return `{ ${Object.entries(value as object).map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(', ')} }`;
        }
        const inner = `${indent}    `;
        if (Array.isArray(value)) return `[\n${value.map((item) => inner + format(item, inner)).join(',\n')}\n${indent}]`;
        if (typeof value === 'object' && value !== null) {
            const entries = Object.entries(value).filter(([, item]) => item !== undefined);
            return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${format(item, inner)}`).join(',\n')}\n${indent}}`;
        }
        return JSON.stringify(value);
    };
    return `${format(catalog, '')}\n`;
}

/** Pull request body describing the sync. */
export function formatSyncReport(report: SyncReport, sourceErrors: string[]): string {
    const section = (title: string, items: string[]) => (items.length > 0 ? [`### ${title}`, '', ...items.map((item) => `- ${item}`), ''] : []);
    return [
        'Automated daily sync of `packages/happy-wire/src/modelCatalog.json` from the upstream model lists.',
        'Merging publishes it: happy-server serves the catalog from `main` to the app and CLI within the hour.',
        '',
        ...section('Needs review', report.review),
        ...section('Added', report.added),
        ...section('Retired', report.retired),
        ...section('Updated', report.updated),
        ...section('Gemini CLI models not in the catalog (not added automatically)', report.geminiCandidates.map((id) => `\`${id}\``)),
        ...section('Sources that failed (their part of the catalog was left unchanged)', sourceErrors),
        'The Codex CLI version (`codexCli`) is maintained by hand and is never changed by this sync.',
    ].join('\n');
}
