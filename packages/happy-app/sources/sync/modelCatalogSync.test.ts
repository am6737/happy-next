import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, server } = vi.hoisted(() => ({
    storage: new Map<string, string>(),
    server: { url: 'https://api.example', listeners: [] as Array<(url: string) => void> },
}));

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) { return storage.get(key); }
        set(key: string, value: string) { storage.set(key, value); }
    },
}));

vi.mock('./serverConfig', () => ({
    getServerUrl: () => server.url,
    onServerUrlChanged: (listener: (url: string) => void) => {
        server.listeners.push(listener);
        return () => {};
    },
}));

function jsonResponse(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

async function load() {
    const wire = await import('happy-wire');
    const sync = await import('./modelCatalogSync');
    const opus5 = wire.BUNDLED_MODEL_CATALOG.models.find((model) => model.id === 'claude-opus-5')!;
    const withOpus6 = {
        ...wire.BUNDLED_MODEL_CATALOG,
        models: [{ ...opus5, id: 'claude-opus-6', label: 'Opus 6', displayName: 'Claude Opus 6' }, ...wire.BUNDLED_MODEL_CATALOG.models],
    };
    return { wire, sync, withOpus6 };
}

describe('model catalog sync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        storage.clear();
        server.url = 'https://api.example';
        server.listeners = [];
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('applies and caches the server catalog', async () => {
        const { wire, sync, withOpus6 } = await load();
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(withOpus6));
        vi.stubGlobal('fetch', fetchMock);

        sync.startModelCatalogSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(fetchMock).toHaveBeenCalledWith('https://api.example/v1/model-catalog', expect.anything());
        expect(wire.isModelModeForAgent('claude', 'claude-opus-6-high')).toBe(true);
        expect(JSON.parse(storage.get('catalog')!).models[0].id).toBe('claude-opus-6');
    });

    it('applies the cached catalog before the server answers', async () => {
        const { wire, sync, withOpus6 } = await load();
        storage.set('catalog', JSON.stringify(withOpus6));
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

        sync.startModelCatalogSync();

        expect(wire.isModelModeForAgent('claude', 'claude-opus-6-high')).toBe(true);
    });

    it('ignores a corrupt cache and retries a failed request', async () => {
        const { wire, sync, withOpus6 } = await load();
        storage.set('catalog', '{not json');
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(jsonResponse(withOpus6));
        vi.stubGlobal('fetch', fetchMock);

        sync.startModelCatalogSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(wire.getModelCatalog()).toBe(wire.BUNDLED_MODEL_CATALOG);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(wire.isModelModeForAgent('claude', 'claude-opus-6-high')).toBe(true);
    });

    it('refetches from the new server when the server URL changes', async () => {
        const { sync, withOpus6 } = await load();
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(withOpus6));
        vi.stubGlobal('fetch', fetchMock);

        sync.startModelCatalogSync();
        await vi.advanceTimersByTimeAsync(0);
        server.url = 'https://other.example';
        server.listeners.forEach((listener) => listener(server.url));
        await vi.advanceTimersByTimeAsync(0);

        expect(fetchMock).toHaveBeenLastCalledWith('https://other.example/v1/model-catalog', expect.anything());
    });

    it('keeps the bundled catalog on servers without the endpoint', async () => {
        const { wire, sync } = await load();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));

        sync.startModelCatalogSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(wire.getModelCatalog()).toBe(wire.BUNDLED_MODEL_CATALOG);
    });
});
