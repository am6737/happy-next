import { beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import { usePlanExpansion } from './usePlanExpansion';

// No mocking: the hook reaches for nothing but a module-scope map, and that map is the whole
// point — it is what has to survive the row being unmounted and mounted again.
function Harness(props: { messageId: string | undefined }) {
    api = usePlanExpansion(props.messageId);
    return null;
}

let api: ReturnType<typeof usePlanExpansion> | null = null;
const mounted: { current: ReturnType<typeof create> | null } = { current: null };

function render(messageId: string | undefined): ReturnType<typeof create> {
    let renderer!: ReturnType<typeof create>;
    act(() => {
        renderer = create(React.createElement(Harness, { messageId }));
    });
    mounted.current = renderer;
    return renderer;
}

/** What the list does to a row that leaves its window: unmount, then mount again on the way back. */
function remount(messageId: string | undefined): void {
    act(() => { mounted.current!.unmount(); });
    api = null;
    render(messageId);
}

beforeEach(() => {
    api = null;
    mounted.current = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('usePlanExpansion', () => {
    it('starts folded, with nothing measured', () => {
        render('msg-1');

        expect(api!.expanded).toBe(false);
        expect(api!.heightPx).toBe(null);
    });

    it('comes back open after the row is unmounted and mounted again', () => {
        render('msg-1');
        act(() => { api!.reportHeight(900); });
        act(() => { api!.toggle(); });

        remount('msg-1');

        expect(api!.expanded).toBe(true);
        // The height comes back too, so the row does not have to be measured again to know whether
        // it was long enough to need the button at all.
        expect(api!.heightPx).toBe(900);
    });

    it('comes back folded when the reader opened a different plan', () => {
        render('msg-1');
        act(() => { api!.toggle(); });

        remount('msg-2');

        expect(api!.expanded).toBe(false);
    });

    it('does not go looking for state when there is no row id to key it by', () => {
        render(undefined);
        act(() => { api!.reportHeight(900); });
        act(() => { api!.toggle(); });

        expect(api!.expanded).toBe(true);

        remount(undefined);

        expect(api!.expanded).toBe(false);
    });

    it('remembers the last measurement, not the first', () => {
        render('msg-3');
        act(() => { api!.reportHeight(900); });
        act(() => { api!.reportHeight(260); });

        remount('msg-3');

        expect(api!.heightPx).toBe(260);
    });
});
