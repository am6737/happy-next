import { parser as markdownParser } from '@lezer/markdown';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import { jsonLanguage } from '@codemirror/lang-json';
import { javascriptLanguage, typescriptLanguage, jsxLanguage, tsxLanguage } from '@codemirror/lang-javascript';
import { pythonLanguage } from '@codemirror/lang-python';
import { xmlLanguage } from '@codemirror/lang-xml';
import { yamlLanguage } from '@codemirror/lang-yaml';
import { StandardSQL } from '@codemirror/lang-sql';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { escapeHtml } from '@/components/FilePreview/staticDocument';
import { normalizeTextLanguage } from './textDocument';

const shellLanguage = StreamLanguage.define(shell);

function languageParser(language: string) {
    switch (normalizeTextLanguage(language)) {
        case 'markdown': return markdownParser;
        case 'html': return htmlLanguage.parser;
        case 'css': return cssLanguage.parser;
        case 'json': return jsonLanguage.parser;
        case 'javascript': return javascriptLanguage.parser;
        case 'typescript': return typescriptLanguage.parser;
        case 'jsx': return jsxLanguage.parser;
        case 'tsx': return tsxLanguage.parser;
        case 'python': return pythonLanguage.parser;
        case 'xml': return xmlLanguage.parser;
        case 'yaml': return yamlLanguage.parser;
        case 'shell': return shellLanguage.parser;
        case 'sql': return StandardSQL.language.parser;
        default: return null;
    }
}

/** Highlight without changing any source characters, including line endings. */
export function highlightTextToHtml(text: string, language: string): string {
    const parser = languageParser(language);
    if (!parser) return escapeHtml(text);

    const out: string[] = [];
    let position = 0;
    highlightTree(parser.parse(text), classHighlighter, (from, to, classes) => {
        out.push(escapeHtml(text.slice(position, from)));
        out.push(`<span class="${classes}">${escapeHtml(text.slice(from, to))}</span>`);
        position = to;
    });
    out.push(escapeHtml(text.slice(position)));
    return out.join('');
}
