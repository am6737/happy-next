// The web chat list draws its own scrollbar in a strip on its right edge; anything overlaid on that
// edge (the minimap) has to know how wide the strip is to stay clear of it.

// Native scrollbar width varies (Windows classic ~17px, Linux ~15px, overlay
// engines 0): a fixed strip would clip a wider classic bar. Probe it once;
// overlay bars measure 0 and fall back to a hover-friendly minimum.
const PROXY_MIN_WIDTH_PX = 14;
let measuredScrollbarWidthPx: number | null = null;
export function proxyStripWidthPx(): number {
    if (measuredScrollbarWidthPx == null) {
        if (typeof document === 'undefined' || !document.body) return PROXY_MIN_WIDTH_PX;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;';
        document.body.appendChild(probe);
        measuredScrollbarWidthPx = probe.offsetWidth - probe.clientWidth;
        probe.remove();
    }
    return Math.max(measuredScrollbarWidthPx, PROXY_MIN_WIDTH_PX);
}
