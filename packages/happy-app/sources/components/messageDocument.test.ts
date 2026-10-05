import { describe, expect, it } from 'vitest';
import { messageDocumentView } from './messageDocument';

describe('messageDocumentView', () => {
    it('opens a collapsed summary under its own title, on the rendered tab', () => {
        expect(messageDocumentView('compaction')).toEqual({
            titleKey: 'textSelection.titleOriginalText',
            tab: 'preview',
        });
    });

    it('opens an over-long message under its own title, on the rendered tab', () => {
        expect(messageDocumentView('too-long')).toEqual({
            titleKey: 'textSelection.titleFullText',
            tab: 'preview',
        });
    });

    it('leaves the long-press flows exactly as they were', () => {
        expect(messageDocumentView(undefined)).toEqual({ titleKey: 'textSelection.title', tab: 'source' });
    });

    it('falls back for anything it does not recognise rather than opening on a blank title', () => {
        expect(messageDocumentView('nonsense')).toEqual({ titleKey: 'textSelection.title', tab: 'source' });
        expect(messageDocumentView('')).toEqual({ titleKey: 'textSelection.title', tab: 'source' });
    });
});
