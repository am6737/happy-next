import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { DatePicker } from './DatePicker';
import type { DatePickerPopoverProps } from './DatePickerPopover';

/**
 * Web: floats the picker above the row it is placed in (put it next to the row, inside a common
 * parent) so opening it does not grow the form. A click anywhere but the picker closes it, as does
 * Escape. Outside the parent the click or key is not passed on, so an enclosing sheet or modal
 * stays open; on the parent's own controls the click goes through.
 */
export function DatePickerPopover({ visible, onClose, ...pickerProps }: DatePickerPopoverProps) {
    const { theme } = useUnistyles();
    const panelRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!visible) return;
        const panel = panelRef.current;
        // The parent holds the control that toggles the picker, so it is treated apart from the
        // rest of the page: its own controls still get their click (see `onClick`).
        const anchor = panel?.parentElement;
        const onPointerDown = (event: PointerEvent) => {
            if (!anchor || anchor.contains(event.target as Node)) return;
            onClose();
            // This press only dismisses the picker: what is under the pointer (the sheet's
            // backdrop, say) must not also react to the click that follows it. React takes
            // clicks at the root, below `document`, so stopping it in the capture phase is enough.
            const swallowClick = (clickEvent: MouseEvent) => {
                clickEvent.stopPropagation();
                clickEvent.preventDefault();
            };
            document.addEventListener('click', swallowClick, true);
            // The click comes right after the release; if there is none (a drag), do not keep
            // swallowing the user's next one.
            document.addEventListener('pointerup', () => {
                setTimeout(() => document.removeEventListener('click', swallowClick, true), 0);
            }, { once: true, capture: true });
        };
        // A click on the parent, outside the picker, closes it as well, but is passed on: it may be
        // the toggle or another option. Closing is deferred until that handler has run; closing
        // first would let the toggle reopen the picker it was meant to close.
        const onClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (anchor?.contains(target) && !panel?.contains(target)) setTimeout(onClose, 0);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Capture and stop it: otherwise the enclosing modal would close the whole sheet. RN
            // Web's Modal closes on the keyup, which arrives after this listener is gone, so that
            // one is swallowed here too.
            event.stopPropagation();
            document.addEventListener('keyup', (keyUpEvent) => {
                if (keyUpEvent.key === 'Escape') keyUpEvent.stopPropagation();
            }, { once: true, capture: true });
            onClose();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [visible, onClose]);

    if (!visible) return null;

    return (
        <div
            ref={panelRef}
            style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 8,
                zIndex: 100,
                width: 'max-content',
                maxWidth: '100%',
                boxSizing: 'border-box',
                backgroundColor: theme.colors.surface,
                border: `1px solid ${theme.colors.divider}`,
                borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
            }}
        >
            <DatePicker {...pickerProps} />
        </div>
    );
}
