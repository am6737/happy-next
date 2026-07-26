import React from 'react';
import { createPortal } from 'react-dom';

export function SessionContextMenuPortal({ children }: { children: React.ReactNode }) {
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                pointerEvents: 'none',
            }}
        >
            {children}
        </div>,
        document.body,
    );
}
