import { normalizeCommandSearchText } from './search';

export type HighlightSegment = {
    text: string;
    highlighted: boolean;
};

function normalizeWithSourceMap(value: string): { normalized: string; sourceIndexes: number[] } {
    let normalized = '';
    const sourceIndexes: number[] = [];

    for (let index = 0; index < value.length;) {
        const codePoint = value.codePointAt(index);
        if (codePoint === undefined) break;
        const character = String.fromCodePoint(codePoint);
        const normalizedCharacter = character
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase()
            .replace(/[\\/_-]+/g, ' ');
        for (const outputCharacter of normalizedCharacter) {
            normalized += outputCharacter;
            sourceIndexes.push(index);
        }
        index += character.length;
    }

    return { normalized, sourceIndexes };
}

export function splitCommandHighlightSegments(value: string, rawQuery: string): HighlightSegment[] {
    const tokens = normalizeCommandSearchText(rawQuery).split(' ').filter(Boolean);
    if (!value || tokens.length === 0) return [{ text: value, highlighted: false }];

    const { normalized, sourceIndexes } = normalizeWithSourceMap(value);
    const ranges: Array<{ start: number; end: number }> = [];

    for (const token of tokens) {
        let fromIndex = 0;
        while (fromIndex < normalized.length) {
            const matchIndex = normalized.indexOf(token, fromIndex);
            if (matchIndex < 0) break;
            const sourceStart = sourceIndexes[matchIndex];
            const finalNormalizedIndex = matchIndex + token.length - 1;
            const sourceEndIndex = sourceIndexes[finalNormalizedIndex];
            const finalCodePoint = value.codePointAt(sourceEndIndex);
            const sourceEnd = sourceEndIndex + (finalCodePoint !== undefined ? String.fromCodePoint(finalCodePoint).length : 1);
            ranges.push({ start: sourceStart, end: sourceEnd });
            fromIndex = matchIndex + Math.max(token.length, 1);
        }
    }

    if (ranges.length === 0) return [{ text: value, highlighted: false }];
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end) {
            previous.end = Math.max(previous.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }

    const segments: HighlightSegment[] = [];
    let cursor = 0;
    for (const range of merged) {
        if (range.start > cursor) {
            segments.push({ text: value.slice(cursor, range.start), highlighted: false });
        }
        segments.push({ text: value.slice(range.start, range.end), highlighted: true });
        cursor = range.end;
    }
    if (cursor < value.length) {
        segments.push({ text: value.slice(cursor), highlighted: false });
    }
    return segments;
}
