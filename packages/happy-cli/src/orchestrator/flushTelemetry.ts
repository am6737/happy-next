import { join } from 'node:path';
import type { ApiClient } from '@/api/api';
import { eventIdentityHash, flushEvents } from './eventQueue';
import { flushUsage } from './usageQueue';
import { flushFinishes } from './finishQueue';
import { hasUnsupportedTelemetry, readLegacyTelemetryBinding, unsupportedTelemetryRoute,
  verifyLegacyTelemetryArchive } from './telemetryCompatibility';

type FinishReport = Parameters<ApiClient['reportOrchestratorExecutionFinish']>[0];

export async function flushTelemetryAndFinishes(root: string, api: Pick<ApiClient,
  'reportUsageDelta' | 'reportExecutionEvent' | 'reportOrchestratorExecutionFinish'>,
  onError?: (queue: 'Usage' | 'Event' | 'Finish', file: string, error: unknown) => void): Promise<void> {
  const events = join(root, 'events');
  const usage = join(root, 'usage');
  const pendingUsage = await flushUsage(usage, (item) => api.reportUsageDelta(item),
    (file, error) => onError?.('Usage', file, error),
    (item, error) => unsupportedTelemetryRoute(error, item.executionId, 'usage'));
  const pendingEvents = await flushEvents(events, (item) => api.reportExecutionEvent(item),
    (file, error) => onError?.('Event', file, error),
    (item, error) => unsupportedTelemetryRoute(error, item.executionId, 'event'));
  await flushFinishes(root, (report) => api.reportOrchestratorExecutionFinish(report),
    (file, error) => onError?.('Finish', file, error),
    (report) => !pendingEvents.has(eventIdentityHash(report.executionId))
      && !pendingUsage.has(eventIdentityHash(report.executionId)),
    async (report): Promise<FinishReport> => {
      if (!await hasUnsupportedTelemetry(events, usage, report.executionId)) return report;
      const legacy = await readLegacyTelemetryBinding(root, report.executionId, report.dispatchToken);
      if (legacy) {
        await verifyLegacyTelemetryArchive(root, report.executionId, legacy.machineId);
        return report;
      }
      return { ...report, status: 'failed', errorCode: 'TELEMETRY_ENDPOINT_UNSUPPORTED',
        errorMessage: 'Execution telemetry could not be delivered to this server version',
        outputSummary: undefined, outputText: undefined, finalResponse: undefined,
        integrationProof: undefined };
    });
}
