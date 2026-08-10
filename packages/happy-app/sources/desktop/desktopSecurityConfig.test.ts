import { existsSync, readFileSync } from 'node:fs';
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

    it('leaves file drag and drop to the HTML5 frontend in desktop builds', () => {
        const production = readJson('src-tauri/tauri.conf.json');
        const preview = readJson('src-tauri/tauri.preview.conf.json');

        expect(production.app.windows[0].dragDropEnabled).toBe(false);
        expect(preview.app.windows[0].dragDropEnabled).toBe(false);
    });

    it('mounts the web code editor without CSP-blocked srcdoc scripts', () => {
        const editorSource = readFileSync(
            resolve(process.cwd(), 'sources/components/CodeEditor.web.tsx'),
            'utf8',
        );

        expect(editorSource).toContain('new EditorView');
        expect(editorSource).not.toContain('<iframe');
        expect(editorSource).not.toContain('srcDoc=');
        expect(directive(readJson('src-tauri/tauri.conf.json').app.security.csp, 'script-src'))
            .not.toContain("'unsafe-inline'");
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
            'core:window:allow-is-fullscreen',
            'core:window:allow-is-maximized',
            'core:window:allow-minimize',
            'core:window:allow-start-dragging',
            'core:window:allow-toggle-maximize',
        ]));
        expect(permissions.some((permission) => permission.includes('shell'))).toBe(false);
        expect(permissions.some((permission) => permission.includes('fs:'))).toBe(false);
        expect(permissions).not.toContain('opener:allow-open-path');
        expect(permissions).toEqual(expect.arrayContaining([
            'process:allow-restart',
            'updater:allow-check',
            'updater:allow-download',
            'updater:allow-install',
        ]));
        expect(permissions).not.toContain('process:allow-exit');
    });

    it('pins production updates to the official signed GitHub release feed', () => {
        const config = readJson('src-tauri/tauri.conf.json');

        expect(config.bundle.createUpdaterArtifacts).toBe(true);
        expect(config.plugins.updater.endpoints).toEqual([
            'https://github.com/hitosea/happy-next/releases/latest/download/latest.json',
        ]);
        expect(config.plugins.updater.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/);
        expect(config.plugins.updater.pubkey.length).toBeGreaterThan(100);
        expect(config.plugins.updater.pubkey).not.toContain('PRIVATE');
        expect(config.plugins.updater.windows.installMode).toBe('passive');
        expect(config.plugins.updater.dangerousInsecureTransportProtocol).not.toBe(true);
    });

    it('isolates the insecure loopback updater endpoint to the explicit test app', () => {
        const config = readJson('src-tauri/tauri.updater-test.conf.json');

        expect(config.productName).toBe('Happy Next Update Test');
        expect(config.identifier).toBe('com.hitosea.happy.updatetest');
        expect(config.plugins.updater.endpoints).toEqual([
            'http://127.0.0.1:18765/latest.json',
        ]);
        expect(config.plugins.updater.dangerousInsecureTransportProtocol).toBe(true);
    });

    it('keeps credential-free desktop CI and guarded release automation in place', () => {
        const desktopCi = readFileSync(resolve(process.cwd(), '../../.github/workflows/desktop-ci.yml'), 'utf8');
        const release = readFileSync(resolve(process.cwd(), '../../.github/workflows/release.yml'), 'utf8');
        const dockerRelease = readFileSync(resolve(process.cwd(), '../../.github/workflows/docker-publish.yml'), 'utf8');
        const webAppDockerfile = readFileSync(resolve(process.cwd(), '../../Dockerfile.webapp'), 'utf8');
        const dockerCompose = readFileSync(resolve(process.cwd(), '../../docker-compose.yml'), 'utf8');
        const iosSubmit = readFileSync(resolve(process.cwd(), '../../.github/workflows/ios-submit.yml'), 'utf8');

        expect(desktopCi).toContain('Build unsigned macOS Universal bundles');
        expect(desktopCi).toContain('Build unsigned Windows x64 installers');
        expect(desktopCi).toContain('Build unsigned Windows ARM64 installers');
        expect(desktopCi).toContain('windows-11-arm');
        expect(desktopCi).toContain('yarn workspace happy-app test --run');
        expect(existsSync(resolve(process.cwd(), '../../.github/workflows/desktop-release.yml'))).toBe(false);

        expect(release).toContain('PUBLISH-RELEASE');
        expect(release).not.toMatch(/\n  push:\s*\n\s+tags:/);
        expect(release).toContain('build-desktop-macos');
        expect(release).toContain('already exists; refusing to overwrite it');
        expect(release).toContain('generateDesktopUpdateManifest.cjs');
        expect(release).toContain('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}');
        expect(release).toContain('happy-next-${RELEASE_TAG}-macos-universal.app.tar.gz.sig');
        expect(release).toContain('happy-next-$env:RELEASE_TAG-windows-${{ matrix.asset_arch }}-setup.exe');
        expect(release).toContain('happy-next-${RELEASE_TAG}-android.${{ matrix.ext }}');
        expect(release).toContain('happy-next-${RELEASE_TAG}-ios.ipa');
        expect(release).toContain("[ \"$name\" != 'latest.json' ]");
        expect(release).toContain('desktop-release-artifacts');
        expect(release).toContain('tauri:build:windows:arm64');
        expect(release).toContain('ASC_API_KEY_P8_BASE64: ${{ secrets.ASC_API_KEY_P8_BASE64 }}');
        expect(release).toContain('yarn workspace happy-app tauri:build:macos:universal --ci --config "$RUNNER_TEMP/tauri-version.json"');
        expect(release).toContain('Notarize and staple macOS disk image');
        expect(release).not.toContain('$env:TAURI_CONFIG');
        expect(release).not.toContain('export TAURI_CONFIG');
        expect(release).not.toContain('tauri:build:windows:x64 --ci --no-sign');
        expect(release).not.toMatch(/\bset\s+-x\b/);
        expect(release).not.toMatch(/echo\s+"\$APPLE_/);

        expect(dockerRelease).toContain('PUBLISH-DOCKER');
        expect(dockerRelease).toContain('ref: ${{ inputs.release_tag }}');
        expect(dockerRelease).toContain('value=${{ inputs.release_tag }}');
        expect(dockerRelease).toContain('APP_VERSION=${{ inputs.release_tag }}');
        expect(dockerRelease).not.toMatch(/\n  push:\s*\n\s+tags:/);
        expect(webAppDockerfile).toContain('ARG APP_VERSION="2.0.0"');
        expect(webAppDockerfile).toContain('ENV APP_VERSION=$APP_VERSION');
        expect(dockerCompose).toContain('APP_VERSION: ${APP_VERSION:-2.0.0}');

        expect(iosSubmit).toContain('SUBMIT-IOS');
        expect(iosSubmit).toContain('happy-next-${RELEASE_TAG}-ios.ipa');
        expect(iosSubmit).toContain('gh release download "$RELEASE_TAG"');
        expect(iosSubmit).toContain('eas submit');
        expect(iosSubmit).not.toContain('eas build --local');
    });
});
