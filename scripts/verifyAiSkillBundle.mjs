import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILES = 64;
const MAX_BYTES = 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyAiSkillBundle(directory, manifest) {
    assert.ok(manifest.skillId && Number.isSafeInteger(manifest.version) && manifest.version > 0, 'Immutable skill identity/version required');
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAX_FILES, 'Invalid skill file count');
    assert.ok(!lstatSync(directory).isSymbolicLink(), 'Skill directory cannot be a symbolic link');
    const root = realpathSync(directory);
    const names = new Set(); let total = 0;
    for (const file of manifest.files) {
        assert.ok(typeof file.path === 'string' && file.path.length <= 512
            && !file.path.includes('\\') && !/^[a-zA-Z]:/.test(file.path) && !/[\u0000-\u001f\u007f]/.test(file.path)
            && file.path.split('/').every((part) => part && part !== '.' && part !== '..'), 'Unsafe skill file path');
        assert.ok(!names.has(file.path), 'Duplicate skill file'); names.add(file.path);
        assert.match(file.sha256, /^[a-f0-9]{64}$/, 'Full file SHA-256 required');
        assert.ok(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0, 'Invalid file byte count');
        let location = root;
        const segments = file.path.split('/');
        for (let index = 0; index < segments.length; index++) {
            location = join(location, segments[index]); const stat = lstatSync(location);
            assert.ok(!stat.isSymbolicLink(), 'Skill path contains a symbolic link');
            assert.ok(index === segments.length - 1 ? stat.isFile() : stat.isDirectory(), 'Skill path has unexpected file type');
            if (index === segments.length - 1) {
                assert.equal(stat.nlink, 1, 'Skill file cannot be a hard link');
                assert.equal(stat.size, file.sizeBytes, 'Installed file byte count mismatch');
                total += stat.size;
                assert.ok(total <= MAX_BYTES, 'Skill bundle exceeds size limit');
            }
        }
        const bytes = readFileSync(location);
        assert.equal(digest(bytes), file.sha256, 'Installed skill file hash mismatch');
        if (file.path === 'SKILL.md') {
            assert.ok(bytes.length > 0, 'SKILL.md is empty');
            new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
    }
    assert.ok(names.has('SKILL.md'), 'Bundle has no SKILL.md');
    const walk = (location, prefix) => {
        for (const entry of readdirSync(location, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = join(location, entry.name); const stat = lstatSync(full);
            assert.ok(!stat.isSymbolicLink(), 'Bundle contains an undeclared symbolic link');
            if (stat.isDirectory()) walk(full, relative);
            else assert.ok(stat.isFile() && names.has(relative), 'Bundle contains an undeclared file');
        }
    };
    walk(root, '');
    return { skillId: manifest.skillId, version: manifest.version, files: names.size, sizeBytes: total };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        assert.equal(process.argv.length, 4, 'Usage: node scripts/verifyAiSkillBundle.mjs installed-directory expected-manifest.json');
        const result = verifyAiSkillBundle(process.argv[2], JSON.parse(readFileSync(process.argv[3], 'utf8')));
        console.log(JSON.stringify({ result: 'AI_SKILL_INSTALLED_FILES_VERIFIED_OK', ...result }));
    } catch (error) { console.error(error instanceof Error ? error.message : 'Skill verification failed'); process.exitCode = 1; }
}
