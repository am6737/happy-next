import { describe, expect, it } from 'vitest';
import { buildOtaManifest, buildOtaMultipart, buildRollBackToEmbeddedDirective, otaAssetPath } from './otaManifest';

const asset = (hash: string) => ({ hash, key: '0'.repeat(32), fileExtension: '.png', contentType: 'image/png' });

describe('buildOtaManifest', () => {
    it('makes urls from hashes and puts the config in extra.expoClient', () => {
        const manifest = buildOtaManifest({
            id: 'id',
            runtimeVersion: 'rt',
            createdAt: new Date('2026-10-24T00:00:00Z'),
            content: { launchAsset: asset('L'), assets: [asset('A')], expoClient: { name: 'Happy' } },
        }, (h) => `https://s3/${otaAssetPath(h)}`);
        expect(manifest).toMatchObject({
            id: 'id',
            createdAt: '2026-10-24T00:00:00.000Z',
            runtimeVersion: 'rt',
            launchAsset: { hash: 'L', url: 'https://s3/ota/assets/L' },
            assets: [{ hash: 'A', url: 'https://s3/ota/assets/A', fileExtension: '.png' }],
            extra: { expoClient: { name: 'Happy' } },
        });
    });
});

describe('buildOtaMultipart', () => {
    it('writes named JSON parts between boundaries', () => {
        const directive = buildRollBackToEmbeddedDirective(new Date('2026-10-24T00:00:00Z'));
        const { contentType, body } = buildOtaMultipart([{ name: 'directive', json: directive }]);
        const boundary = contentType.match(/^multipart\/mixed; boundary=(.+)$/)![1];
        expect(body.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="directive"\r\n`)).toBe(true);
        expect(body.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
        const json = body.split('\r\n\r\n')[1].split('\r\n')[0];
        expect(JSON.parse(json)).toEqual({ type: 'rollBackToEmbedded', parameters: { commitTime: '2026-10-24T00:00:00.000Z' } });
    });
});
