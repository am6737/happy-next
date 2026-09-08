import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureLogoutStage } from './logoutTiming';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('logout timing', () => {
    it('logs static stage timings in development and preserves results', async () => {
        vi.stubGlobal('__DEV__', true);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(52);
        await expect(measureLogoutStage('test', async () => 123)).resolves.toBe(123);
        expect(log.mock.calls).toEqual([
            ['[logout] test: start'], ['[logout] test: ok (42ms)'],
        ]);
    });

    it('preserves errors without logging their potentially sensitive contents', async () => {
        vi.stubGlobal('__DEV__', true);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = new Error('sensitive payload');
        await expect(measureLogoutStage('test', async () => { throw error; })).rejects.toBe(error);
        expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^\[logout\] test: failed \(\d+ms\)$/));
        expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive payload');
    });

    it('does not log in production', async () => {
        vi.stubGlobal('__DEV__', false);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        await expect(measureLogoutStage('test', async () => 'done')).resolves.toBe('done');
        expect(log).not.toHaveBeenCalled();
    });
});
