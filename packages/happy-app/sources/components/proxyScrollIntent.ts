// Scroll events alone are not proof of user input: WebKit also emits them
// after programmatic writes and scroll-range changes.
export function createProxyScrollIntent(quietMs: number) {
    let pointerDown = false;
    let lastInputAt = -Infinity;
    return {
        input(now: number) { lastInputAt = now; },
        pointerDown(now: number) { pointerDown = true; lastInputAt = now; },
        pointerUp(now: number) { pointerDown = false; lastInputAt = now; },
        cancel() { pointerDown = false; lastInputAt = -Infinity; },
        acceptScroll(now: number) {
            if (!pointerDown && now - lastInputAt >= quietMs) return false;
            // Keep accepting momentum until the gesture goes quiet.
            lastInputAt = now;
            return true;
        },
    };
}
