/**
 * Gives `@xterm/headless` the two `navigator` fields it reads while its module
 * body is still being evaluated.
 *
 * React Native's `navigator` is `{ product: 'ReactNative' }` — no `userAgent`,
 * no `platform` — and Hermes' `process` has no `title`, which is the only thing
 * the library checks before it concludes it is not running under Node:
 *
 *     isNode = !(typeof process === 'undefined' || !('title' in process)
 *         || (typeof navigator !== 'undefined' && !navigator.userAgent.startsWith('Node.js/')));
 *     agent = isNode ? 'node' : navigator.userAgent;
 *     ... isFirefox = agent.includes('Firefox') ...
 *
 * On Hermes the guard falls through, `agent` is undefined, and the module dies
 * before it exports anything: "Cannot read property 'includes' of undefined".
 * Metro inlines requires, so that throw is reported at the caller's
 * `new HeadlessTerminal(...)`, which makes it read as a broken terminal rather
 * than as platform detection — and it happens only on the phone, since the web
 * and desktop builds have a real user agent.
 *
 * Nothing in the headless build consumes what it detects; every flag it derives
 * comes out false, which is the honest answer for a terminal with no DOM. The
 * writes are skipped wherever a real user agent already exists, so browsers and
 * Node — which resolve the same file — keep their own.
 *
 * Imported first from the app entry: the failure is at module initialisation,
 * so nothing that pulls the library in later can undo it.
 */

interface ShimmableNavigator {
    userAgent?: string;
    platform?: string;
}

const host = globalThis as unknown as { navigator?: ShimmableNavigator };
const hostNavigator = host.navigator;

if (hostNavigator) {
    hostNavigator.userAgent ??= 'ReactNative';
    hostNavigator.platform ??= 'ReactNative';
}
