import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { describeServerError } from './serverError';

function axiosFailure(status: number, data: unknown) {
    return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', undefined, undefined,
        { status, data, statusText: '', headers: {}, config: {} as never });
}

describe('describeServerError', () => {
    it('keeps the server error code and explains github_not_connected', () => {
        const result = describeServerError(axiosFailure(409, { error: 'github_not_connected' }));
        expect(result.message).toContain('HTTP 409');
        expect(result.message).toContain('github_not_connected');
        expect(result.message).toContain('connect GitHub');
        expect(result.message).not.toContain('Request failed with status code');
    });
    it('distinguishes already_delegated from other 409s', () => {
        expect(describeServerError(axiosFailure(409, { error: 'already_delegated' })).message).toContain('already has an open task');
    });
    it('explains that issue_not_found also covers pull requests', () => {
        expect(describeServerError(axiosFailure(404, { error: 'issue_not_found' })).message)
            .toContain('The issue or pull request does not exist or is closed.');
    });
    it('keeps unknown codes without a hint', () => {
        expect(describeServerError(axiosFailure(409, { error: 'weird_code' })).message).toBe('Server rejected the request (HTTP 409, weird_code)');
    });
    it('passes through axios errors without a coded body and non-axios errors', () => {
        const bare = axiosFailure(502, 'bad gateway');
        expect(describeServerError(bare)).toBe(bare);
        const plain = new Error('boom');
        expect(describeServerError(plain)).toBe(plain);
        expect(describeServerError('x').message).toBe('x');
    });
});
