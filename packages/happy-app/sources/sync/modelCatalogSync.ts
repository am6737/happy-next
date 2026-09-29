import { MMKV } from 'react-native-mmkv';
import { parseModelCatalog, setModelCatalog } from 'happy-wire';
import { getServerUrl, onServerUrlChanged } from './serverConfig';

// Separate MMKV instance so the catalog survives logouts, like the server config
const modelCatalogStorage = new MMKV({ id: 'model-catalog' });

const CACHE_KEY = 'catalog';
const MODEL_CATALOG_PATH = '/v1/model-catalog';
const REFRESH_INTERVAL_MS = 30 * 60_000;
const RETRY_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

let started = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(delayMs: number) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncModelCatalog(), delayMs);
}

/** Fetch the current server's catalog, apply it and cache it. Returns false to retry. */
async function fetchModelCatalog(): Promise<boolean> {
    const serverUrl = getServerUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${serverUrl}${MODEL_CATALOG_PATH}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        // Servers that predate the endpoint answer 404: keep the bundled catalog, don't hammer them.
        if (response.status === 404) return true;
        if (!response.ok) return false;
        const catalog = parseModelCatalog(await response.json());
        // An invalid catalog will not fix itself on retry; wait for the next refresh.
        if (!catalog) return true;
        // The server changed while the request was in flight; its own sync follows.
        if (getServerUrl() !== serverUrl) return true;
        setModelCatalog(catalog);
        modelCatalogStorage.set(CACHE_KEY, JSON.stringify(catalog));
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function syncModelCatalog() {
    const synced = await fetchModelCatalog();
    scheduleSync(synced ? REFRESH_INTERVAL_MS : RETRY_DELAY_MS);
}

/**
 * Model catalog sync.
 *
 * The app starts with the catalog bundled in happy-wire, replaced right away by
 * the copy cached from the last successful fetch. It then fetches the catalog
 * from the server (which tracks the published one), every 30 minutes after
 * that, and immediately when the server URL changes; failures retry after a
 * minute. So new models, labels and context windows reach the pickers without
 * an app release. Call once after the server config is resolved.
 */
export function startModelCatalogSync() {
    if (started) return;
    started = true;
    const catalog = parseModelCatalog(readCachedCatalog());
    if (catalog) setModelCatalog(catalog);
    onServerUrlChanged(() => scheduleSync(0));
    void syncModelCatalog();
}

function readCachedCatalog(): unknown {
    try {
        return JSON.parse(modelCatalogStorage.getString(CACHE_KEY) ?? 'null');
    } catch {
        return null;
    }
}
