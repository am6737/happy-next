import { parseMarkdown, type MarkdownSpan } from '../markdown/parseMarkdown';

export function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (char) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[char]!
    );
}

export function safeImageSource(url: string): boolean {
    return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url);
}

/** Reading colors that override the author's own foreground, background and borders. */
function darkOverlay(): string {
    return `<style>html{color-scheme:dark!important}html,body,body *{color:#e5e7eb!important;background-color:#202124!important;background-image:none!important;border-color:#62666c!important;box-shadow:none!important;text-shadow:none!important}body pre,body code,body th{background-color:#303238!important}body img{background-color:transparent!important}</style>`;
}

/**
 * Appends markup to the end of an authored document, before its last `</body>` / `</html>`.
 * A document without a closing tag (a fragment) simply gets the markup appended.
 */
function appendToDocument(html: string, markup: string): string {
    const lower = html.toLowerCase();
    for (const tag of ['</body>', '</html>']) {
        const index = lower.lastIndexOf(tag);
        if (index !== -1)
            return `${html.slice(0, index)}${markup}${html.slice(index)}`;
    }
    return html + markup;
}

/**
 * An HTML file renders as authored — scripts, inline handlers and external resources all
 * work. The sandboxed frame is the boundary, not a sanitizer, so nothing is rewritten here.
 */
export function buildHtmlDocument(html: string, dark = false): string {
    return dark ? appendToDocument(html, darkOverlay()) : html;
}

function spans(items: MarkdownSpan[]): string {
    return items
        .map((item) => {
            if (item.imageUrl)
                return safeImageSource(item.imageUrl)
                    ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.text)}">`
                    : `<span>${escapeHtml(item.text || '[image]')}</span>`;
            let result = escapeHtml(item.text);
            const styles = {
                bold: 'strong',
                semibold: 'strong',
                italic: 'em',
                code: 'code',
                strikethrough: 'del',
                underline: 'u',
            };
            for (const style of item.styles)
                result = `<${styles[style]}>${result}</${styles[style]}>`;
            return item.url
                ? `<span title="${escapeHtml(item.url)}">${result}</span>`
                : result;
        })
        .join('');
}

export function markdownPreviewHtml(markdown: string): string {
    return parseMarkdown(markdown)
        .map((block) => {
            switch (block.type) {
                case 'text':
                    return `<p>${spans(block.content)}</p>`;
                case 'header':
                    return `<h${block.level}>${spans(block.content)}</h${block.level}>`;
                case 'horizontal-rule':
                    return '<hr>';
                case 'code-block':
                case 'mermaid':
                    return `<pre><code>${escapeHtml(block.content)}</code></pre>`;
                case 'list':
                    return `<ul>${block.items.map((item) => `<li style="margin-left:${Math.min(item.depth, 12) * 16}px">${spans(item.spans)}</li>`).join('')}</ul>`;
                case 'numbered-list':
                    return `<ol>${block.items.map((item) => `<li value="${item.number}" style="margin-left:${Math.min(item.depth, 12) * 16}px">${spans(item.spans)}</li>`).join('')}</ol>`;
                case 'blockquote':
                    return `<blockquote>${block.content.map((item) => `<p>${spans(item.spans)}</p>`).join('')}</blockquote>`;
                case 'image':
                    return safeImageSource(block.url)
                        ? `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}">`
                        : `<p>${escapeHtml(block.alt || '[image]')}</p>`;
                case 'table':
                    return `<div class="table-scroll"><table><thead><tr>${block.headers.map((cell) => `<th>${spans(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${spans(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
                case 'options':
                    return `<ul>${block.items.map((item) => `<li>${escapeHtml(item.title)}</li>`).join('')}</ul>`;
            }
        })
        .join('');
}

/**
 * Markdown is serialized from the app's own parser, so its document keeps the restrictive
 * CSP and never runs a script.
 */
export function buildMarkdownDocument(markdown: string, dark = false): string {
    const body = markdownPreviewHtml(markdown);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>
html{color-scheme:light;background:white;color:#202124;letter-spacing:0}body{margin:0;padding:20px;overflow-wrap:anywhere;font:16px/1.6 system-ui,sans-serif}*{box-sizing:border-box}img{max-width:100%;height:auto}pre,.table-scroll{max-width:100%;overflow:auto}pre{background:#f3f4f5;padding:12px;border-radius:4px}code{font-family:monospace}table{border-collapse:collapse}td,th{padding:8px 12px;border:1px solid #d9dcdf;text-align:left}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #a4aaaf}h1{font-size:28px}h2{font-size:24px}h3{font-size:20px}hr{border:0;border-top:1px solid #d9dcdf}
</style></head><body>${body}${dark ? darkOverlay() : ''}</body></html>`;
}

export function buildSvgDocument(
    base64: string,
    dark: boolean,
    zoom: number
): string {
    if (!/^[a-z0-9+/=\s]*$/i.test(base64)) throw new Error('Invalid SVG data');
    const scale = Math.max(0.5, Math.min(4, zoom));
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;min-height:100%;background:${dark ? '#202124' : '#ffffff'}}img{display:block;width:${scale * 100}vw;height:${scale * 100}vh;object-fit:contain}</style></head><body><img alt="SVG" src="data:image/svg+xml;base64,${base64}"></body></html>`;
}
