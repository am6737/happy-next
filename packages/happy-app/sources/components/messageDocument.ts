/**
 * Which document a collapsed message row opened, and what that means for the screen showing it.
 *
 * The route param is the collapse reason `messageCollapse.ts` produced, so the entry point and the
 * rule that created it speak the same vocabulary. Long-press flows (`LongPressCopy`, the markdown
 * long-press) pass nothing: they are about selecting text, not about a collapsed row, and they keep
 * that screen's original title and tab.
 */
export type MessageDocumentView = {
    /** The header title the entry point reads under. */
    titleKey: 'textSelection.title' | 'textSelection.titleFullText' | 'textSelection.titleOriginalText';
    /** The tab the document opens on: a hand-written message pasted in bulk is read as source, a summary as prose. */
    tab: 'preview' | 'source';
};

export function messageDocumentView(from: string | undefined): MessageDocumentView {
    switch (from) {
        case 'compaction':
            return { titleKey: 'textSelection.titleOriginalText', tab: 'preview' };
        case 'too-long':
            return { titleKey: 'textSelection.titleFullText', tab: 'preview' };
        default:
            return { titleKey: 'textSelection.title', tab: 'source' };
    }
}
