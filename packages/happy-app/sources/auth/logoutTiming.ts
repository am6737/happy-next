// Development-only lifecycle diagnostics. Labels are static: never log tokens,
// credentials, server URLs, or exception payloads here.
export async function measureLogoutStage<T>(stage: string, task: () => Promise<T>): Promise<T> {
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
        return task();
    }
    const started = performance.now();
    console.log(`[logout] ${stage}: start`);
    let outcome = 'ok';
    try {
        return await task();
    } catch (error) {
        outcome = 'failed';
        throw error;
    } finally {
        console.log(`[logout] ${stage}: ${outcome} (${Math.round(performance.now() - started)}ms)`);
    }
}
