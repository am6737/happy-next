export type TextDocumentFormat = 'markdown' | 'html' | 'plain';

export const TEXT_DOCUMENT_CODE_LANGUAGE_LABELS = {
    json: 'JSON', javascript: 'JavaScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
    css: 'CSS', python: 'Python', xml: 'XML', yaml: 'YAML', shell: 'Shell', sql: 'SQL',
} as const;

export type TextDocumentCodeLanguage = keyof typeof TEXT_DOCUMENT_CODE_LANGUAGE_LABELS;
export type TextDocumentMode = 'auto' | TextDocumentFormat | TextDocumentCodeLanguage;

export function isTextDocumentCodeLanguage(language: string): language is TextDocumentCodeLanguage {
    return Object.prototype.hasOwnProperty.call(TEXT_DOCUMENT_CODE_LANGUAGE_LABELS, language);
}

export type TextDocument = {
    format: TextDocumentFormat;
    /** Code language when the document is displayed as selectable text. */
    language: string;
};

const LANGUAGE_ALIASES: Record<string, string> = {
    md: 'markdown', htm: 'html', js: 'javascript', ts: 'typescript',
    py: 'python', yml: 'yaml', sh: 'shell', bash: 'shell',
    txt: 'plaintext', text: 'plaintext', plain: 'plaintext',
};

export function normalizeTextLanguage(language: string): string {
    const normalized = language.trim().toLowerCase();
    const alias = LANGUAGE_ALIASES[normalized];
    return typeof alias === 'string' ? alias : normalized;
}

function documentForLanguage(language: string): TextDocument {
    const normalized = normalizeTextLanguage(language) || 'plaintext';
    return {
        format: normalized === 'html' || normalized === 'markdown' ? normalized : 'plain',
        language: normalized,
    };
}

function readFormat(format: string | undefined): TextDocumentFormat | undefined {
    return format === 'markdown' || format === 'html' || format === 'plain' ? format : undefined;
}

/** A known source wins over content guesses; a manual choice wins over both. */
export function resolveTextDocument({ text, mode = 'auto', sourceFormat, sourceLanguage }: {
    text: string;
    mode?: TextDocumentMode;
    sourceFormat?: string;
    sourceLanguage?: string;
}): TextDocument {
    if (mode !== 'auto') {
        return documentForLanguage(mode === 'plain' ? 'plaintext' : mode);
    }

    const format = readFormat(sourceFormat);
    if (format) {
        return format === 'plain'
            ? { format, language: normalizeTextLanguage(sourceLanguage || 'plaintext') }
            : documentForLanguage(format);
    }
    if (sourceLanguage?.trim()) return documentForLanguage(sourceLanguage);

    // Only standalone documents qualify. A tag in prose, an HTML fragment, or a fenced
    // HTML example is still Markdown unless the source or the user says otherwise.
    const content = text.trim().replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
    if (/^<!doctype\s+html\b[^>]*>/i.test(content)
        || /^<html(?:\s[^>]*)?>[\s\S]*<\/html\s*>\s*$/i.test(content)) {
        return documentForLanguage('html');
    }
    return documentForLanguage('markdown');
}
