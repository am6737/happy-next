import { describe, expect, it } from 'vitest';
import { formatDesktopDiagnostics, sanitizeDiagnosticUrl } from './desktopDiagnostics';

describe('desktop diagnostics', () => {
    it('removes credentials, query parameters, and fragments from server URLs', () => {
        expect(sanitizeDiagnosticUrl('https://user:secret@example.com/base?token=secret#fragment'))
            .toBe('https://example.com/base');
        expect(sanitizeDiagnosticUrl('not a url')).toBe('invalid-url');
    });

    it('formats useful state without credential values', () => {
        const report = formatDesktopDiagnostics({
            native: {
                appName: 'Happy Next',
                appVersion: '2.0.0',
                identifier: 'com.hitosea.happy',
                operatingSystem: 'macos',
                architecture: 'aarch64',
                buildProfile: 'release',
                updaterTestMode: false,
                logDirectory: '/tmp/happy-logs',
            },
            server: {
                entryUrl: 'https://user:password@example.com?token=private',
                resolvedUrl: 'https://api.example.com/v1?secret=value',
                isCustom: true,
            },
            socket: {
                status: 'connected',
                lastConnectedAt: 0,
                lastDisconnectedAt: null,
            },
            webviewUserAgent: 'WebKit',
        });

        expect(report).toContain('Happy Next 2.0.0');
        expect(report).toContain('Server entry: https://example.com');
        expect(report).toContain('Socket: connected');
        expect(report).not.toContain('password');
        expect(report).not.toContain('private');
        expect(report).not.toContain('secret=value');
    });
});
