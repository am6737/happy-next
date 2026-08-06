import { describe, expect, it } from 'vitest';
import { isLoopbackUrl, validateS3PublicUrl } from './s3PublicUrl';

describe('S3 public URL validation', () => {
    it.each([
        'http://localhost:9000/happy',
        'http://assets.localhost/happy',
        'http://127.0.0.1:9000/happy',
        'http://127.42.0.1:9000/happy',
        'http://[::1]:9000/happy',
    ])('recognizes loopback URL %s', (url) => {
        expect(isLoopbackUrl(url)).toBe(true);
    });

    it('normalizes trailing slashes', () => {
        expect(validateS3PublicUrl({
            S3_PUBLIC_URL: 'https://assets.example.com/happy///',
        })).toBe('https://assets.example.com/happy');
    });

    it('allows localhost for an all-local production deployment', () => {
        expect(validateS3PublicUrl({
            NODE_ENV: 'production',
            APP_URL: 'http://localhost:3030',
            S3_PUBLIC_URL: 'http://localhost:9000/happy',
        })).toBe('http://localhost:9000/happy');
    });

    it('rejects localhost when production advertises an external app URL', () => {
        expect(() => validateS3PublicUrl({
            NODE_ENV: 'production',
            APP_URL: 'https://app.example.com',
            S3_PUBLIC_URL: 'http://localhost:9000/happy',
        })).toThrow(/reachable by desktop, web, and mobile clients/);
    });

    it('rejects missing and malformed values', () => {
        expect(() => validateS3PublicUrl({})).toThrow('S3_PUBLIC_URL is required');
        expect(() => validateS3PublicUrl({ S3_PUBLIC_URL: 'minio:9000' })).toThrow('must use http or https');
    });
});
