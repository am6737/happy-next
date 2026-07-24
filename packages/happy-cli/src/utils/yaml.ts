import { parse as parseYaml } from 'yaml';

export function isYamlRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseYamlRecord(source: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = parseYaml(source);
        return isYamlRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function readYamlString(value: unknown, collapseWhitespace = false): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = collapseWhitespace ? value.replace(/\s+/g, ' ').trim() : value.trim();
    return normalized || undefined;
}

export function parseMarkdownFrontmatter(markdown: string): Record<string, unknown> | null {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    return parseYamlRecord(match[1]);
}
