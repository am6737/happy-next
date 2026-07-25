export type MessagePreviewTextOptions = {
    codePlaceholder?: string;
    imagePlaceholder?: string;
};

function replaceFencedCodeBlocks(text: string, placeholder: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const output: string[] = [];
    let fenceCharacter: '`' | '~' | null = null;
    let fenceLength = 0;

    for (const line of lines) {
        if (!fenceCharacter) {
            const openingFence = line.match(/^\s*(`{3,}|~{3,})/);
            if (!openingFence) {
                output.push(line);
                continue;
            }

            fenceCharacter = openingFence[1][0] as '`' | '~';
            fenceLength = openingFence[1].length;
            output.push(placeholder);
            continue;
        }

        const closingFence = line.trim();
        if (
            closingFence.length >= fenceLength
            && [...closingFence].every((character) => character === fenceCharacter)
        ) {
            fenceCharacter = null;
            fenceLength = 0;
        }
    }

    return output.join('\n');
}

/**
 * Converts rich message text into a compact, single-line, plain-text preview.
 * It preserves readable content while removing Markdown syntax and replacing
 * content that is unsuitable for a system notification with short labels.
 */
export function formatMessagePreviewText(
    text: string,
    options: MessagePreviewTextOptions = {},
): string {
    const codePlaceholder = options.codePlaceholder ?? '[Code]';
    const imagePlaceholder = options.imagePlaceholder ?? '[Image]';

    return replaceFencedCodeBlocks(text, codePlaceholder)
        // Remove content that should never appear in a preview.
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/^[ \t]*\[[^\]]+\]:[ \t]+\S+.*$/gm, ' ')
        // Preserve image alt text when available; otherwise use a compact label.
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => alt.trim() || imagePlaceholder)
        .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_, alt: string) => alt.trim() || imagePlaceholder)
        // Keep link labels, but discard destinations and Markdown wrappers.
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)]\[[^\]]*\]/g, '$1')
        .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1')
        // Remove block-level Markdown syntax.
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
        .replace(/[ \t]+#{1,6}[ \t]*$/gm, '')
        .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
        .replace(/^[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
        .replace(/^[ \t]{0,3}\[[ xX]\][ \t]+/gm, '')
        .replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, ' ')
        // Remove inline Markdown wrappers while retaining their visible text.
        .replace(/(`+)([\s\S]*?)\1/g, '$2')
        .replace(/(^|[\s([{])\*\*([^*\n]+)\*\*(?=$|[\s)\]},.!?:;])/g, '$1$2')
        .replace(/(^|[\s([{])__([^_\n]+)__(?=$|[\s)\]},.!?:;])/g, '$1$2')
        .replace(/(^|[\s([{])~~([^~\n]+)~~(?=$|[\s)\]},.!?:;])/g, '$1$2')
        .replace(/(^|[\s([{])\*([^*\n]+)\*(?=$|[\s)\]},.!?:;])/g, '$1$2')
        .replace(/(^|[\s([{])_([^_\n]+)_(?=$|[\s)\]},.!?:;])/g, '$1$2')
        // Strip common Markdown HTML tags without damaging types such as Promise<T>.
        .replace(/<\/?(?:a|abbr|b|blockquote|br|code|del|details|div|em|h[1-6]|hr|i|img|li|ol|p|pre|span|strong|summary|table|tbody|td|th|thead|tr|ul)(?:\s[^>]*)?\s*\/?>/gi, ' ')
        .replace(/\\([\\`*{}\[\]()#+.!_>~-])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

export function truncateMessagePreviewText(text: string, maxLength: number): string {
    const characters = Array.from(text);
    return characters.length > maxLength
        ? `${characters.slice(0, maxLength).join('')}...`
        : text;
}
