import { parseModelCatalog, setModelCatalog } from "happy-wire";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { warn } from "@/utils/log";
import { shutdownSignal } from "@/utils/shutdown";

const DEFAULT_MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/hitosea/happy-next/main/packages/happy-wire/src/modelCatalog.json';
const REFRESH_INTERVAL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;

/** Source of the model catalog; blank means the default, `off` keeps the bundled catalog. */
function modelCatalogUrl(): string | null {
    const configured = process.env.MODEL_CATALOG_URL?.trim();
    if (configured === 'off') return null;
    return configured || DEFAULT_MODEL_CATALOG_URL;
}

/**
 * Fetches the catalog from `url` and makes it the active one. Throws when the
 * request fails or the payload does not match the schema, leaving the active
 * catalog untouched.
 */
export async function refreshModelCatalog(url: string): Promise<void> {
    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = parseModelCatalog(await response.json());
    if (!catalog) throw new Error('payload does not match the model catalog schema');
    setModelCatalog(catalog);
}

/**
 * Keeps the server's model catalog in sync with the published one.
 *
 * Every 10 minutes it fetches the catalog JSON (by default modelCatalog.json on
 * the repository's main branch) and, if it passes the happy-wire schema, makes
 * it the active catalog. `/v1/model-catalog` serves the active catalog to the
 * app and CLI, and server-side model validation reads it too. A failed fetch or
 * an invalid payload keeps the previous catalog — the bundled one until the
 * first successful fetch — so a bad publish never takes the model list away.
 */
export function startModelCatalogRefresh() {
    const url = modelCatalogUrl();
    if (!url) return;
    forever('model-catalog-refresh', async () => {
        try {
            await refreshModelCatalog(url);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn({ module: 'model-catalog' }, `Failed to refresh model catalog from ${url}: ${message}`);
        }
        await delay(REFRESH_INTERVAL_MS, shutdownSignal);
    });
}
