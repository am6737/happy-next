import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { archiveUnsupported, inspectUnsupportedArchives, requireUnsupportedArchiveCapacity } from './unsupportedArchive';

it('retains archives and stops new dispatch at capacity without deleting evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-unsupported-'));
  const archive = join(root, 'unsupported');
  mkdirSync(archive);
  try {
    const record = join(archive, 'event.json');
    writeFileSync(record, '{"eventId":"fixture"}');
    writeFileSync(`${record}.reason`, 'TELEMETRY_ENDPOINT_UNSUPPORTED\n');
    expect(await inspectUnsupportedArchives([root])).toEqual({ records: 1,
      bytes: Buffer.byteLength('{"eventId":"fixture"}') + Buffer.byteLength('TELEMETRY_ENDPOINT_UNSUPPORTED\n') });
    await requireUnsupportedArchiveCapacity([root]);
    truncateSync(record, 64 * 1024 * 1024);
    await expect(requireUnsupportedArchiveCapacity([root])).rejects.toThrow('capacity reached');
    expect((await inspectUnsupportedArchives([root])).records).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('stores a digest and refuses to overwrite a different archived record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'happy-unsupported-digest-'));
  try {
    writeFileSync(join(root, 'one.json'), '{"value":1}', { mode: 0o600 });
    await archiveUnsupported(root, 'one.json');
    const archived = join(root, 'unsupported', 'one.json');
    const metadata = JSON.parse(readFileSync(`${archived}.reason`, 'utf8'));
    expect(metadata).toMatchObject({ reason: 'TELEMETRY_ENDPOINT_UNSUPPORTED',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 11 });
    writeFileSync(join(root, 'one.json'), '{"value":2}', { mode: 0o600 });
    await expect(archiveUnsupported(root, 'one.json')).rejects.toThrow('identity changed');
    expect(readFileSync(archived, 'utf8')).toBe('{"value":1}');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
