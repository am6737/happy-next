import { register, Counter, Gauge, Histogram } from 'prom-client';
import { db } from '@/storage/db';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';

// Application metrics
export const websocketConnectionsGauge = new Gauge({
    name: 'websocket_connections_total',
    help: 'Number of active WebSocket connections',
    labelNames: ['type'] as const,
    registers: [register]
});

export const sessionAliveEventsCounter = new Counter({
    name: 'session_alive_events_total',
    help: 'Total number of session-alive events',
    registers: [register]
});

export const machineAliveEventsCounter = new Counter({
    name: 'machine_alive_events_total',
    help: 'Total number of machine-alive events',
    registers: [register]
});

export const sessionCacheCounter = new Counter({
    name: 'session_cache_operations_total',
    help: 'Total session cache operations',
    labelNames: ['operation', 'result'] as const,
    registers: [register]
});

export const databaseUpdatesSkippedCounter = new Counter({
    name: 'database_updates_skipped_total',
    help: 'Number of database updates skipped due to debouncing',
    labelNames: ['type'] as const,
    registers: [register]
});

export const websocketEventsCounter = new Counter({
    name: 'websocket_events_total',
    help: 'Total WebSocket events received by type',
    labelNames: ['event_type'] as const,
    registers: [register]
});

export const httpRequestsCounter = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [register]
});

export const httpRequestDurationHistogram = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    registers: [register]
});

// Database count metrics
export const databaseRecordCountGauge = new Gauge({
    name: 'database_records_total',
    help: 'Total number of records in database tables',
    labelNames: ['table'] as const,
    registers: [register]
});

export const aiWorkflowQueueGauge = new Gauge({
    name: 'ai_workflow_queue_items',
    help: 'AI workflow items by fixed queue and status',
    labelNames: ['queue', 'status'] as const,
    registers: [register]
});

export const aiBudgetMaxUtilizationGauge = new Gauge({
    name: 'ai_budget_max_utilization_ratio',
    help: 'Highest used plus reserved ratio among active AI budget policies',
    registers: [register]
});

export const aiBudgetPoliciesHighWaterGauge = new Gauge({
    name: 'ai_budget_policies_high_water',
    help: 'Number of active AI budget policies above the fixed utilization threshold',
    labelNames: ['threshold'] as const,
    registers: [register]
});

// WebSocket connection tracking
const connectionCounts = {
    'user-scoped': 0,
    'session-scoped': 0,
    'machine-scoped': 0
};

export function incrementWebSocketConnection(type: 'user-scoped' | 'session-scoped' | 'machine-scoped'): void {
    connectionCounts[type]++;
    websocketConnectionsGauge.set({ type }, connectionCounts[type]);
}

export function decrementWebSocketConnection(type: 'user-scoped' | 'session-scoped' | 'machine-scoped'): void {
    connectionCounts[type] = Math.max(0, connectionCounts[type] - 1);
    websocketConnectionsGauge.set({ type }, connectionCounts[type]);
}

// Database metrics updater
export async function updateDatabaseMetrics(): Promise<void> {
    // Query counts for each table
    const [accountCount, sessionCount, messageCount, machineCount,
        pendingDecisions, pendingDelivery, blockedDelivery, reservedBudget,
        unknownBudget] = await Promise.all([
        db.account.count(),
        db.session.count(),
        db.sessionMessage.count(),
        db.machine.count(),
        db.aiDecisionRequest.count({ where: { status: 'pending' } }),
        db.aiDecisionRequest.count({ where: { deliveryStatus: 'pending' } }),
        db.aiDecisionRequest.count({ where: { deliveryStatus: 'blocked' } }),
        db.aiBudgetReservation.count({ where: { status: 'reserved' } }),
        db.aiBudgetReservation.count({ where: { status: 'unknown' } })
    ]);
    const [{ maxRatio, highWater }] = await db.$queryRaw<Array<{
        maxRatio: number; highWater: bigint,
    }>>`
        SELECT COALESCE(MAX(("usedMicros" + "reservedMicros")::numeric
                / "limitMicros"::numeric), 0)::double precision AS "maxRatio",
               COUNT(*) FILTER (WHERE ("usedMicros" + "reservedMicros")::numeric
                   / "limitMicros"::numeric >= 0.9) AS "highWater"
        FROM "AiBudgetPolicy"
        WHERE active = TRUE AND "periodStart" <= clock_timestamp()
          AND "periodEnd" > clock_timestamp() AND "limitMicros" > 0`;

    // Update metrics
    databaseRecordCountGauge.set({ table: 'accounts' }, accountCount);
    databaseRecordCountGauge.set({ table: 'sessions' }, sessionCount);
    databaseRecordCountGauge.set({ table: 'messages' }, messageCount);
    databaseRecordCountGauge.set({ table: 'machines' }, machineCount);
    aiWorkflowQueueGauge.set({ queue: 'decision', status: 'pending' }, pendingDecisions);
    aiWorkflowQueueGauge.set({ queue: 'decision_delivery', status: 'pending' }, pendingDelivery);
    aiWorkflowQueueGauge.set({ queue: 'decision_delivery', status: 'blocked' }, blockedDelivery);
    aiWorkflowQueueGauge.set({ queue: 'budget', status: 'reserved' }, reservedBudget);
    aiWorkflowQueueGauge.set({ queue: 'budget', status: 'unknown' }, unknownBudget);
    aiBudgetMaxUtilizationGauge.set(maxRatio);
    aiBudgetPoliciesHighWaterGauge.set({ threshold: '0.9' }, Number(highWater));
}

export function startDatabaseMetricsUpdater(): void {
    forever('database-metrics-updater', async () => {
        await updateDatabaseMetrics();
        
        // Wait 60 seconds before next update
        await delay(60 * 1000, shutdownSignal);
    });
}

// Export the register for combining metrics
export { register };
