import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryMigrations } from './aiTeamProductionTree.mjs';

const root = mkdtempSync(join(tmpdir(), 'ai-migration-tree-'));
try {
    const directory = join(root, 'migrations');
    const migration = join(directory, '001');
    mkdirSync(migration, { recursive: true });
    assert.equal(inventoryMigrations(root, directory).complete, false);

    const sql = join(migration, 'migration.sql');
    writeFileSync(sql, 'SELECT 1;\n', { mode: 0o644 });
    const initial = inventoryMigrations(root, directory);
    assert.equal(initial.complete, true);
    chmodSync(sql, 0o755);
    assert.notEqual(inventoryMigrations(root, directory).sha256, initial.sha256);

    rmSync(sql);
    symlinkSync('/etc/passwd', sql);
    assert.throws(() => inventoryMigrations(root, directory), /SYMLINK_REJECTED/);
    rmSync(sql);
    writeFileSync(sql, 'SELECT 1;\n');
    symlinkSync('/etc/passwd', join(directory, 'outside'));
    assert.throws(() => inventoryMigrations(root, directory), /SYMLINK_REJECTED/);
    console.log('MIGRATION_TREE_NEGATIVES_OK missing=reject mode=changes symlink=reject');
} finally {
    rmSync(root, { recursive: true, force: true });
}
