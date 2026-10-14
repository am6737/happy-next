import { describe, expect, it, vi } from 'vitest';
import type { ClipboardFilePasteEventLike } from '@/utils/filePaste';
import { handleFilePasteEvent } from '@/utils/filePaste';

const createEvent = (
    items: Array<{ kind: string; file: File | null }>,
    defaultPrevented = false,
): ClipboardFilePasteEventLike & { preventDefault: ReturnType<typeof vi.fn> } => {
    const preventDefault = vi.fn();

    return {
        defaultPrevented,
        preventDefault,
        clipboardData: {
            items: items.map(item => ({
                kind: item.kind,
                getAsFile: () => item.file,
            })),
        },
    };
};

const acceptAll = (files: File[]) => files;

describe('handleFilePasteEvent', () => {
    it('ignores paste when current screen is not focused', async () => {
        const onFiles = vi.fn();
        const event = createEvent([
            { kind: 'file', file: { name: 'x.png', type: 'image/png' } as File },
        ]);

        const handled = await handleFilePasteEvent(event, { isScreenFocused: false, accept: acceptAll, onFiles });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onFiles).not.toHaveBeenCalled();
    });

    it('takes every pasted file and skips text', async () => {
        const onFiles = vi.fn();
        const imageFile = { name: 'test.png', type: 'image/png' } as File;
        const docFile = { name: 'report.pdf', type: 'application/pdf' } as File;
        const event = createEvent([
            { kind: 'string', file: null },
            { kind: 'file', file: imageFile },
            { kind: 'file', file: docFile },
        ]);

        const handled = await handleFilePasteEvent(event, { isScreenFocused: true, accept: acceptAll, onFiles });

        expect(handled).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(onFiles).toHaveBeenCalledWith([imageFile, docFile]);
    });

    it('leaves the paste alone when the composer takes none of the files', async () => {
        const onFiles = vi.fn();
        const event = createEvent([
            { kind: 'file', file: { name: 'report.pdf', type: 'application/pdf' } as File },
        ]);

        const handled = await handleFilePasteEvent(event, { isScreenFocused: true, accept: () => [], onFiles });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onFiles).not.toHaveBeenCalled();
    });

    it('ignores paste when event is already prevented', async () => {
        const onFiles = vi.fn();
        const event = createEvent([
            { kind: 'file', file: { name: 'x.png', type: 'image/png' } as File },
        ], true);

        const handled = await handleFilePasteEvent(event, { isScreenFocused: true, accept: acceptAll, onFiles });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onFiles).not.toHaveBeenCalled();
    });
});
