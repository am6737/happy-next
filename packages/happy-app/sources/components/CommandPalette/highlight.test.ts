import { describe, expect, it } from 'vitest';
import { splitCommandHighlightSegments } from './highlight';

describe('command palette highlighting', () => {
    it('highlights multiple case-insensitive query tokens', () => {
        expect(splitCommandHighlightSegments('Open Project Settings', 'project SET')).toEqual([
            { text: 'Open ', highlighted: false },
            { text: 'Project', highlighted: true },
            { text: ' ', highlighted: false },
            { text: 'Set', highlighted: true },
            { text: 'tings', highlighted: false },
        ]);
    });

    it('maps accent-normalized matches back to the original text', () => {
        expect(splitCommandHighlightSegments('Résumé notes', 'resume')).toEqual([
            { text: 'Résumé', highlighted: true },
            { text: ' notes', highlighted: false },
        ]);
    });

    it('returns plain text when nothing matches', () => {
        expect(splitCommandHighlightSegments('/work/project', 'machine')).toEqual([
            { text: '/work/project', highlighted: false },
        ]);
    });
});
