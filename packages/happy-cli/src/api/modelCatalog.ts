/**
 * Remote model catalog
 *
 * The server publishes the model catalog (models, pricing, Codex version) at
 * `/v1/model-catalog`, so new models reach the CLI without a release. Every CLI
 * process applies the locally cached copy at startup; the long-running daemon
 * fetches the server's catalog now and every 30 minutes and rewrites the cache,
 * so session and one-shot processes it spawns start from a fresh catalog.
 * Without a cache, or when the server is unreachable or too old to serve the
 * catalog, the catalog bundled in happy-wire stays active.
 */

import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import axios from 'axios';
import { parseModelCatalog, setModelCatalog } from 'happy-wire';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

const SYNC_INTERVAL_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

/** Apply the cached catalog, if there is a valid one. */
export function loadCachedModelCatalog(): void {
    try {
        const cacheFile = join(configuration.happyHomeDir, 'model-catalog.json');
        const catalog = parseModelCatalog(JSON.parse(readFileSync(cacheFile, 'utf-8')));
        if (catalog) setModelCatalog(catalog);
    } catch {
        // No cache yet — the bundled catalog stays active.
    }
}

/** Fetch the server's catalog, apply it and cache it for other CLI processes. */
export async function syncModelCatalog(): Promise<void> {
    try {
        const response = await axios.get(`${configuration.serverUrl}/v1/model-catalog`, { timeout: FETCH_TIMEOUT_MS });
        const catalog = parseModelCatalog(response.data);
        if (!catalog) {
            logger.debug('[modelCatalog] Server catalog does not match the schema, keeping the current one');
            return;
        }
        setModelCatalog(catalog);
        const cacheFile = join(configuration.happyHomeDir, 'model-catalog.json');
        const tmpFile = `${cacheFile}.${process.pid}.tmp`;
        await writeFile(tmpFile, JSON.stringify(catalog));
        await rename(tmpFile, cacheFile);
    } catch (error) {
        logger.debug('[modelCatalog] Failed to sync model catalog', error);
    }
}

/** Keep the catalog and its cache fresh for the lifetime of the process (used by the daemon). */
export function startModelCatalogSync(): void {
    void syncModelCatalog();
    setInterval(() => void syncModelCatalog(), SYNC_INTERVAL_MS).unref();
}
