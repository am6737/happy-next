/**
 * The models the signed-in Qoder account offers, with their efforts.
 *
 * Models are per account and only qodercli knows them, so asking means starting
 * qodercli (about 2s, plus a run log under ~/.qoder*). The daemon keeps one list
 * per machine, on disk too, and starts qodercli only when that list is old:
 *
 *   under 5 min   served as is
 *   5 min to 1 h  served, and refreshed in the background for the next ask
 *   over 1 h      refreshed first; served if that fails or times out
 *
 * After a failed refresh qodercli is not started again for 5 min while a list is
 * on hand, or for 1 min with none (asks then fail at once).
 *
 * qodercli is asked with the stream-json `get_models` request the Qoder Agent SDK
 * uses, which answers every model and its efforts at once, and over ACP if that
 * fails, both within one 15s budget.
 */

import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import type { AcpModel } from '@/agent/acp/listAcpModels';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';
import { listQoderModelsOverAcp } from '@/qoder/sessions';
import { createRefreshingCache } from '@/utils/refreshingCache';
import { withShortLivedProcess } from '@/utils/shortLivedProcess';

export type QoderModel = AcpModel;

const QODER_MODELS_BUDGET_MS = 15_000;
const MINUTE_MS = 60_000;

/** Labels qodercli gives efforts over ACP; others are capitalized. */
const EFFORT_LABELS: Record<string, string> = { xhigh: 'Extra High' };

/** An entry of the stream-json `get_models` answer; only the fields read here. */
type CatalogModel = {
  value?: unknown;
  displayName?: unknown;
  isDefault?: boolean;
  isEnabled?: boolean;
  isReasoning?: boolean;
  isVl?: boolean;
  isNew?: boolean;
  priceFactor?: unknown;
  efforts?: unknown;
  supportsDisabled?: boolean;
};

function effortLabel(code: string): string {
  return EFFORT_LABELS[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

/**
 * Turns the `get_models` answer into what ACP reports for the same account, so
 * the app sees one shape whichever way the list came: the default model's name
 * carries "(default)", the description is its tags and credit rate, a model that
 * can turn thinking off takes a `none` effort last, and selecting a model picks
 * its first effort.
 */
export function qoderModelsFromCatalog(models: unknown): QoderModel[] {
  if (!Array.isArray(models)) throw new Error('get_models answered without a model list');
  const result: QoderModel[] = [];
  for (const model of models as CatalogModel[]) {
    if (typeof model?.value !== 'string' || !model.value || model.isEnabled === false) continue;
    const name = typeof model.displayName === 'string' && model.displayName ? model.displayName : model.value;
    const tags = [model.isReasoning && 'Reasoning', model.isVl && 'Vision', model.isNew && 'New'].filter(Boolean);
    if (typeof model.priceFactor === 'number') tags.push(`${model.priceFactor.toFixed(2)}x Credit`);
    const codes = Array.isArray(model.efforts) ? model.efforts.filter((code): code is string => typeof code === 'string' && !!code) : [];
    if (model.supportsDisabled) codes.push('none');
    result.push({
      code: model.value,
      value: model.isDefault ? `${name} (default)` : name,
      ...(tags.length ? { description: tags.join(' · ') } : {}),
      ...(codes.length ? { efforts: codes.map((code) => ({ code, value: effortLabel(code) })), defaultEffort: codes[0] } : {}),
    });
  }
  if (!result.length) throw new Error('get_models answered no models');
  return result;
}

function controlRequest(requestId: string, subtype: string): string {
  return `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype } })}\n`;
}

/** Asks `qodercli --print` in stream-json mode, as the Qoder Agent SDK does. Nothing is prompted, so no session is saved. */
export async function listQoderModelsOverStreamJson(cwd: string, timeoutMs: number): Promise<QoderModel[]> {
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json'];
  const env = { ...process.env, ...QODER_SDK_ISOLATION_ENV };
  return withShortLivedProcess(resolveQoderCommand(), args, { cwd, env, timeoutMs }, async (child) => {
    // stdin stays open: qodercli ends its run when it closes
    child.stdin.write(controlRequest('initialize', 'initialize') + controlRequest('models', 'get_models'));
    for await (const line of createInterface({ input: child.stdout })) {
      let message: { type?: string; response?: { subtype?: string; request_id?: string; error?: string; response?: { models?: unknown } } };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message?.type !== 'control_response' || message.response?.request_id !== 'models') continue;
      if (message.response.subtype !== 'success') throw new Error(message.response.error || 'get_models failed');
      return qoderModelsFromCatalog(message.response.response?.models);
    }
    throw new Error('qodercli closed its output before listing models');
  });
}

async function fetchQoderModels(): Promise<QoderModel[]> {
  // One fixed directory, so what qodercli keeps per directory stays in one place
  const cwd = join(configuration.happyHomeDir, 'qoder');
  await mkdir(cwd, { recursive: true });
  const deadline = Date.now() + QODER_MODELS_BUDGET_MS;
  try {
    return await listQoderModelsOverStreamJson(cwd, QODER_MODELS_BUDGET_MS);
  } catch (error) {
    logger.debug('[Qoder] get_models failed, listing models over ACP', error);
  }
  return listQoderModelsOverAcp(cwd, Math.max(deadline - Date.now(), 0));
}

const qoderModels = createRefreshingCache({
  file: join(configuration.happyHomeDir, 'qoder-models.json'),
  fetch: fetchQoderModels,
  freshMs: 5 * MINUTE_MS,
  maxAgeMs: 60 * MINUTE_MS,
  failureCooldownMs: 5 * MINUTE_MS,
  emptyFailureCooldownMs: MINUTE_MS,
});

export function listQoderModels(): Promise<QoderModel[]> {
  return qoderModels.get();
}
