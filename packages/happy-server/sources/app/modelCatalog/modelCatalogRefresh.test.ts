import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_MODEL_CATALOG, getModelCatalog, isModelModeForAgent, setModelCatalog } from "happy-wire";
import { refreshModelCatalog } from "./modelCatalogRefresh";

const URL = 'https://example.test/modelCatalog.json';

function respondWith(body: unknown, status = 200) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe('refreshModelCatalog', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        setModelCatalog(BUNDLED_MODEL_CATALOG);
    });

    it('activates a valid catalog, so server-side validation accepts its models', async () => {
        const opus5 = BUNDLED_MODEL_CATALOG.models.find((model) => model.id === 'claude-opus-5')!;
        respondWith({
            ...BUNDLED_MODEL_CATALOG,
            codexCli: { package: '@openai/codex', version: '0.160.0' },
            models: [{ ...opus5, id: 'claude-opus-6', label: 'Opus 6', displayName: 'Claude Opus 6' }, ...BUNDLED_MODEL_CATALOG.models],
        });

        await refreshModelCatalog(URL);

        expect(isModelModeForAgent('claude', 'claude-opus-6-high')).toBe(true);
        expect(getModelCatalog().codexCli.version).toBe('0.160.0');
    });

    it('keeps the active catalog when the payload is invalid', async () => {
        respondWith({ schemaVersion: 1, models: 'nope' });
        await expect(refreshModelCatalog(URL)).rejects.toThrow('schema');
        expect(getModelCatalog()).toBe(BUNDLED_MODEL_CATALOG);
    });

    it('keeps the active catalog when the request fails', async () => {
        respondWith({}, 503);
        await expect(refreshModelCatalog(URL)).rejects.toThrow('HTTP 503');
        expect(getModelCatalog()).toBe(BUNDLED_MODEL_CATALOG);
    });
});
