import { Counter, Gauge } from 'prom-client';

const maxConcurrentReads = Number(process.env.AI_DB_READ_CONCURRENCY || 64);
const readLimit = Number.isSafeInteger(maxConcurrentReads) && maxConcurrentReads > 0
    ? Math.min(maxConcurrentReads, 256) : 64;
let activeReads = 0;

export const aiDbCapacityRejections = new Counter({
    name: 'ai_db_capacity_rejections_total',
    help: 'AI database read requests rejected for bounded capacity',
    labelNames: ['reason'] as const,
});
export const aiDbActiveReads = new Gauge({
    name: 'ai_db_active_reads',
    help: 'AI database reads admitted in this API instance',
});

export function acquireAiDbRead(): (() => void) | null {
    if (activeReads >= readLimit) {
        aiDbCapacityRejections.inc({ reason: 'admission' });
        return null;
    }
    activeReads++;
    aiDbActiveReads.set(activeReads);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeReads--;
        aiDbActiveReads.set(activeReads);
    };
}

export function isAiDbCapacityError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = 'code' in error ? error.code : undefined;
    if (code === 'P2024' || code === 'P2037' || code === '53300') return true;
    const name = 'name' in error ? error.name : undefined;
    if (typeof name !== 'string' || !name.startsWith('PrismaClient')) return false;
    const message = 'message' in error ? error.message : undefined;
    return typeof message === 'string' && /too many connections|remaining connection slots|connection pool timeout|timed out fetching a new connection from the connection pool|connection limit exceeded/i.test(message);
}

export function recordAiDbPoolRejection(): void {
    aiDbCapacityRejections.inc({ reason: 'pool' });
}
