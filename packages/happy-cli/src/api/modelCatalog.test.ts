import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLED_MODEL_CATALOG, getModelCatalog, isModelModeForAgent, setModelCatalog } from 'happy-wire';
import { loadCachedModelCatalog, syncModelCatalog } from './modelCatalog';

const { mockGet, homeDir } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    homeDir: { path: '' },
}));

vi.mock('axios', () => ({ default: { get: mockGet } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/configuration', () => ({
    configuration: {
        serverUrl: 'https://api.example.test',
        get happyHomeDir() { return homeDir.path; },
    },
}));

const opus5 = BUNDLED_MODEL_CATALOG.models.find((model) => model.id === 'claude-opus-5')!;
const serverCatalog = {
    ...BUNDLED_MODEL_CATALOG,
    codexCli: { package: '@openai/codex', version: '0.160.0' },
    models: [{ ...opus5, id: 'claude-opus-6', label: 'Opus 6', displayName: 'Claude Opus 6' }, ...BUNDLED_MODEL_CATALOG.models],
};

describe('model catalog sync', () => {
    beforeEach(() => {
        homeDir.path = mkdtempSync(join(tmpdir(), 'happy-model-catalog-'));
        mockGet.mockReset();
    });

    afterEach(() => {
        rmSync(homeDir.path, { recursive: true, force: true });
        setModelCatalog(BUNDLED_MODEL_CATALOG);
    });

    it('applies and caches the server catalog', async () => {
        mockGet.mockResolvedValue({ data: serverCatalog });

        await syncModelCatalog();

        expect(mockGet).toHaveBeenCalledWith('https://api.example.test/v1/model-catalog', expect.anything());
        expect(isModelModeForAgent('claude', 'claude-opus-6-high')).toBe(true);
        const cached = JSON.parse(readFileSync(join(homeDir.path, 'model-catalog.json'), 'utf-8'));
        expect(cached.codexCli.version).toBe('0.160.0');
    });

    it('loads the cached catalog at startup', async () => {
        writeFileSync(join(homeDir.path, 'model-catalog.json'), JSON.stringify(serverCatalog));

        loadCachedModelCatalog();

        expect(getModelCatalog().codexCli.version).toBe('0.160.0');
    });

    it('keeps the current catalog when the cache or server payload is invalid', async () => {
        writeFileSync(join(homeDir.path, 'model-catalog.json'), '{"schemaVersion":1}');
        mockGet.mockResolvedValue({ data: { schemaVersion: 99 } });

        loadCachedModelCatalog();
        await syncModelCatalog();

        expect(getModelCatalog()).toBe(BUNDLED_MODEL_CATALOG);
    });

    it('keeps the current catalog when the server is unreachable', async () => {
        mockGet.mockRejectedValue(new Error('ECONNREFUSED'));

        await syncModelCatalog();

        expect(getModelCatalog()).toBe(BUNDLED_MODEL_CATALOG);
    });
});
