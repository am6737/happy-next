import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAiSkillBundle } from './verifyAiSkillBundle.mjs';

test('verifies installed skill bytes and rejects traversal, substitution, links and unlisted files', () => {
    const root = mkdtempSync(join(tmpdir(), 'happy-skill-acceptance-')); const bundle = join(root, 'bundle');
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    try {
        mkdirSync(join(bundle, 'references'), { recursive: true });
        const main = '# Owned fixture\n\nRead references/rules.md.\n'; const rules = 'Exact rules\n';
        writeFileSync(join(bundle, 'SKILL.md'), main); writeFileSync(join(bundle, 'references/rules.md'), rules);
        const manifest = { skillId: 'owned-fixture', version: 1, files: [
            { path: 'SKILL.md', sha256: hash(main), sizeBytes: Buffer.byteLength(main) },
            { path: 'references/rules.md', sha256: hash(rules), sizeBytes: Buffer.byteLength(rules) },
        ] };
        assert.equal(verifyAiSkillBundle(bundle, manifest).files, 2);
        for (const path of ['../outside', '/absolute', 'C:/outside', 'references/../outside', 'a\\b', 'a//b', 'a\nb'])
            assert.throws(() => verifyAiSkillBundle(bundle, { ...manifest, files: [{ ...manifest.files[0], path }] }), /Unsafe/);
        writeFileSync(join(bundle, 'references/rules.md'), 'Wrong rules\n');
        assert.throws(() => verifyAiSkillBundle(bundle, manifest), /hash mismatch/);
        writeFileSync(join(bundle, 'references/rules.md'), rules);
        writeFileSync(join(bundle, 'unlisted.txt'), 'Unexpected');
        assert.throws(() => verifyAiSkillBundle(bundle, manifest), /undeclared file/);
        rmSync(join(bundle, 'unlisted.txt'));
        writeFileSync(join(root, 'outside'), rules); rmSync(join(bundle, 'references/rules.md'));
        symlinkSync(join(root, 'outside'), join(bundle, 'references/rules.md'));
        assert.throws(() => verifyAiSkillBundle(bundle, manifest), /symbolic link/);
        rmSync(join(bundle, 'references/rules.md')); linkSync(join(root, 'outside'), join(bundle, 'references/rules.md'));
        assert.throws(() => verifyAiSkillBundle(bundle, manifest), /hard link/);
        rmSync(join(bundle, 'references/rules.md')); writeFileSync(join(bundle, 'references/rules.md'), rules);
        assert.equal(verifyAiSkillBundle(bundle, manifest).files, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
