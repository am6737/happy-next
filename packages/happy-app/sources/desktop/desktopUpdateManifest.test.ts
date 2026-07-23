import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    generateDesktopUpdateManifest,
    normalizeVersion,
} = require('../scripts/generateDesktopUpdateManifest.cjs') as {
    normalizeVersion(value: string): string;
    generateDesktopUpdateManifest(options: {
        version: string;
        repository: string;
        artifactsDir: string;
        outputPath: string;
        notes?: string;
        pubDate?: string;
    }): any;
};

describe('desktop updater manifest generator', () => {
    it('normalizes release tags and rejects invalid versions', () => {
        expect(normalizeVersion('v2.3.4')).toBe('2.3.4');
        expect(() => normalizeVersion('latest')).toThrow('Invalid desktop update version');
    });

    it('generates signed platform entries for universal macOS and both Windows architectures', () => {
        const directory = mkdtempSync(join(tmpdir(), 'happy-desktop-update-'));
        writeFileSync(join(directory, 'Happy.Next.app.tar.gz'), 'mac');
        writeFileSync(join(directory, 'Happy.Next.app.tar.gz.sig'), 'mac-signature\n');
        writeFileSync(join(directory, 'Happy.Next_2.3.4_x64-setup.nsis.zip'), 'windows-x64');
        writeFileSync(join(directory, 'Happy.Next_2.3.4_x64-setup.nsis.zip.sig'), 'windows-x64-signature\n');
        writeFileSync(join(directory, 'Happy.Next_2.3.4_arm64-setup.nsis.zip'), 'windows-arm64');
        writeFileSync(join(directory, 'Happy.Next_2.3.4_arm64-setup.nsis.zip.sig'), 'windows-arm64-signature\n');
        const outputPath = join(directory, 'latest.json');

        const manifest = generateDesktopUpdateManifest({
            version: 'v2.3.4',
            repository: 'hitosea/happy-next',
            artifactsDir: directory,
            outputPath,
            notes: 'Desktop update',
            pubDate: '2026-07-23T00:00:00.000Z',
        });

        expect(manifest.platforms['darwin-aarch64']).toEqual(manifest.platforms['darwin-x86_64']);
        expect(manifest.platforms['windows-x86_64'].signature).toBe('windows-x64-signature');
        expect(manifest.platforms['windows-x86_64'].url).toContain('.nsis.zip');
        expect(manifest.platforms['windows-aarch64'].signature).toBe('windows-arm64-signature');
        expect(manifest.platforms['windows-aarch64'].url).toContain('_arm64-setup.nsis.zip');
        expect(manifest.platforms['darwin-aarch64'].url).toContain('/releases/download/v2.3.4/');
        expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(manifest);
    });
});
