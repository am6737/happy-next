import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQoderModelModesCache, fillQoderModelModes, qoderModelModesFromListing } from './qoderModelModes';

const listing = {
    success: true,
    models: [
        { code: 'auto', name: 'Auto' },
        { code: 'performance', name: 'Performance', efforts: [{ code: 'low', value: 'Low' }, { code: 'high', value: 'High' }] },
    ],
};

describe('qoderModelModesFromListing', () => {
    it('lists default, each model and each model:effort', () => {
        expect(qoderModelModesFromListing(listing)).toEqual(['default', 'auto', 'performance', 'performance:low', 'performance:high']);
    });

    it('returns null for a failed listing', () => {
        expect(qoderModelModesFromListing({ success: false, errorMessage: 'no' })).toBeNull();
        expect(qoderModelModesFromListing(null)).toBeNull();
    });
});

describe('fillQoderModelModes', () => {
    beforeEach(() => clearQoderModelModesCache());

    it('asks only online machines with Qoder, and caches the answer', async () => {
        const call = vi.fn().mockResolvedValue(listing);
        const machines = [
            { machineId: 'a', online: true, providers: ['claude', 'qoder'], modelModes: { claude: ['default'], qoder: ['default'] } },
            { machineId: 'b', online: true, providers: ['claude'], modelModes: { claude: ['default'] } },
            { machineId: 'c', online: false, providers: ['qoder'], modelModes: { qoder: ['default'] } },
        ];

        const filled = await fillQoderModelModes(machines, call);

        expect(call).toHaveBeenCalledTimes(1);
        expect(call).toHaveBeenCalledWith('a:qoder-list-models', {}, expect.any(Number));
        expect(filled[0].modelModes).toEqual({ claude: ['default'], qoder: ['default', 'auto', 'performance', 'performance:low', 'performance:high'] });
        expect(filled[1]).toBe(machines[1]);
        expect(filled[2]).toBe(machines[2]);

        await fillQoderModelModes(machines, call);
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('keeps what the server sent when the daemon does not answer', async () => {
        const call = vi.fn().mockRejectedValue(new Error('RPC method not available'));
        const machine = { machineId: 'a', online: true, providers: ['qoder'], modelModes: { qoder: ['default'] } };

        expect(await fillQoderModelModes([machine], call)).toEqual([machine]);
        await fillQoderModelModes([machine], call);
        expect(call).toHaveBeenCalledTimes(2);
    });
});
