import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson(path: string): any {
    return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
}

function directive(csp: string, name: string): string[] {
    const value = csp.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `));
    return value?.split(/\s+/).slice(1) ?? [];
}

describe('desktop security configuration', () => {
    it('keeps production network access encrypted while retaining required blob support', () => {
        const config = readJson('src-tauri/tauri.conf.json');
        const connectSources = directive(config.app.security.csp, 'connect-src');

        expect(connectSources).toEqual(expect.arrayContaining(["'self'", 'ipc:', 'blob:', 'https:', 'wss:']));
        expect(connectSources).not.toContain('http:');
        expect(connectSources).not.toContain('ws:');
        expect(directive(config.app.security.csp, 'object-src')).toEqual(["'none'"]);
    });

    it('isolates development and preview policies from production', () => {
        const development = readJson('src-tauri/tauri.dev.conf.json');
        const preview = readJson('src-tauri/tauri.preview.conf.json');

        expect(development.app.security.csp).toBeNull();
        expect(directive(preview.app.security.csp, 'connect-src')).toEqual(
            expect.arrayContaining(['http:', 'https:', 'ws:', 'wss:']),
        );
    });

    it('grants only the core window and event commands used by the desktop bridge', () => {
        const capability = readJson('src-tauri/capabilities/default.json');
        const permissions: string[] = capability.permissions;

        expect(permissions).not.toContain('core:default');
        expect(permissions).toEqual(expect.arrayContaining([
            'core:event:allow-listen',
            'core:event:allow-unlisten',
            'core:window:allow-close',
            'core:window:allow-is-focused',
            'core:window:allow-is-maximized',
            'core:window:allow-minimize',
            'core:window:allow-start-dragging',
            'core:window:allow-toggle-maximize',
        ]));
        expect(permissions.some((permission) => permission.includes('shell'))).toBe(false);
        expect(permissions.some((permission) => permission.includes('fs:'))).toBe(false);
        expect(permissions).not.toContain('opener:allow-open-path');
    });

    it('keeps credential-free desktop CI and guarded release automation in place', () => {
        const desktopCi = readFileSync(resolve(process.cwd(), '../../.github/workflows/desktop-ci.yml'), 'utf8');
        const release = readFileSync(resolve(process.cwd(), '../../.github/workflows/release.yml'), 'utf8');

        expect(desktopCi).toContain('Build unsigned macOS Universal bundles');
        expect(desktopCi).toContain('Build unsigned Windows x64 installers');
        expect(desktopCi).toContain('yarn workspace happy-app test --run');
        expect(release).toContain('build-desktop-macos');
        expect(release).toContain('needs: [build-android, build-ios, build-desktop-macos, build-desktop-windows]');
        expect(release).toContain('already exists; refusing to overwrite it');
        expect(release).toContain("-name '*.sig'");
        expect(release).toContain('generateDesktopUpdateManifest.cjs');
        expect(release).not.toMatch(/\bset\s+-x\b/);
        expect(release).not.toMatch(/echo\s+"\$APPLE_/);
    });
});
