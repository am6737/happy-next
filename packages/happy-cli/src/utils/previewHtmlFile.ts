/**
 * Resolves `preview_html` tool calls that point at a local HTML file.
 *
 * The tool accepts the document either inline (`html`) or as a path to a file the agent just
 * wrote (`filePath`). Clients only render `html`, so a `filePath` is read here — on the machine
 * that owns the file — and folded into the tool call arguments before they leave the CLI.
 *
 * Reading happens per agent pipeline (Claude remote launcher, Codex, Gemini) so the inlined
 * document is part of the stored conversation and survives the session going offline or archived.
 */

import { readFileSync, statSync } from 'node:fs';
import { logger } from '@/ui/logger';

/**
 * Upper bound for a document that gets inlined into a session message.
 *
 * Messages are encrypted and base64-encoded on the way out, which inflates them by roughly a
 * third, and the server closes sockets above 5 MB. 2 MiB leaves comfortable headroom.
 */
export const MAX_PREVIEW_HTML_FILE_BYTES = 2 * 1024 * 1024;

export type PreviewHtmlFileResult =
    | { ok: true; html: string }
    | { ok: false; error: string };

/**
 * Matches `preview_html` in every spelling agents produce: bare, `happy__preview_html`,
 * `mcp__happy__preview_html` and the colon-separated `mcp:happy:preview_html`.
 */
export function isPreviewHtmlToolName(toolName: unknown): boolean {
    if (typeof toolName !== 'string') return false;
    const normalized = toolName
        .replace(/__/g, ':')
        .replace(/^mcp:/, '')
        .replace(/^happy:/, '');
    return normalized === 'preview_html';
}

/** Reads an HTML file for previewing, enforcing the size cap. Never throws. */
export function readPreviewHtmlFile(filePath: string): PreviewHtmlFileResult {
    try {
        const stats = statSync(filePath);
        if (stats.isDirectory()) {
            return { ok: false, error: 'path is a directory' };
        }
        if (stats.size > MAX_PREVIEW_HTML_FILE_BYTES) {
            return {
                ok: false,
                error: `file is too large (${stats.size} bytes, limit ${MAX_PREVIEW_HTML_FILE_BYTES})`,
            };
        }
        return { ok: true, html: readFileSync(filePath, 'utf8') };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Returns the tool call arguments the client should receive.
 *
 * Anything that is not a `preview_html` call carrying a `filePath` and no inline `html` is
 * returned untouched. A file that cannot be read is left as-is too — the tool handler has
 * already reported that failure to the agent, and a preview call without `html` simply renders
 * nothing rather than a broken document.
 */
export function inlinePreviewHtmlFileArgs(
    toolName: unknown,
    args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (!args || !isPreviewHtmlToolName(toolName)) return args;
    if (typeof args.html === 'string' && args.html.length > 0) return args;

    const filePath = args.filePath;
    if (typeof filePath !== 'string' || filePath.length === 0) return args;

    const result = readPreviewHtmlFile(filePath);
    if (!result.ok) {
        logger.warn(`[preview_html] Cannot read ${filePath}: ${result.error}`);
        return args;
    }

    logger.debug(`[preview_html] Inlined ${result.html.length} characters from ${filePath}`);
    return { ...args, html: result.html };
}
