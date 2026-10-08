import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateReleaseScriptPath(path) {
    if (path.split('/').some((part) => part.startsWith('.env')
        || ['node_modules', 'dist', '.git', '.npmrc', 'auth.json', 'credentials.json',
            'access.key'].includes(part))) throw new Error(`FORBIDDEN_RELEASE_SCRIPT_INPUT: ${path}`);
}

export function inventoryFile(root, path) {
    const fullPath = join(root, path);
    let stat;
    try { stat = lstatSync(fullPath); } catch (error) {
        if (error.code === 'ENOENT') return { path, state: 'missing', sha256: null, mode: null };
        throw error;
    }
    if (!stat.isFile()) throw new Error(`RELEASE_INPUT_NOT_REGULAR_FILE: ${path}`);
    return { path, state: 'present', sha256: sha256(readFileSync(fullPath)), mode: stat.mode & 0o777 };
}

export function inventoryAlternativeFiles(root, paths) {
    const entries = paths.map((path) => inventoryFile(root, path));
    return { entries, ready: entries.some((entry) => entry.state === 'present') };
}

export function inventoryTree(root, directory, {
    allowInternalFileSymlinks = false, validatePath = () => {}, readFile = readFileSync,
} = {}) {
    const validate = (path) => {
        const name = relative(root, path).split('\\').join('/');
        if (name.split('/').some((part) => part.startsWith('.env')))
            throw new Error(`FORBIDDEN_TREE_ENTRY: ${name}`);
        validatePath(name);
        return name;
    };
    validate(directory);
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory()) throw new Error(`TREE_NOT_DIRECTORY: ${directory}`);
    const directoryWithinRoot = relative(realpathSync(root), realpathSync(directory));
    if (isAbsolute(directoryWithinRoot) || directoryWithinRoot === '..'
        || directoryWithinRoot.startsWith(`..${sep}`)) throw new Error('TREE_OUTSIDE_ROOT');
    const files = [];
    function walk(path) {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const fullPath = join(path, entry.name);
            const name = validate(fullPath);
            const stat = lstatSync(fullPath);
            if (stat.isSymbolicLink()) {
                if (!allowInternalFileSymlinks) throw new Error(`SYMLINK_REJECTED: ${name}`);
                const target = readlinkSync(fullPath);
                const resolved = resolve(path, target);
                validate(resolved);
                const inside = relative(root, resolved);
                if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
                    throw new Error(`SYMLINK_ESCAPE: ${name}`);
                }
                if (!['patches', join('packages', 'happy-app', 'patches')].some((base) =>
                    inside.startsWith(`${base}${sep}`)) || inside.split(sep).some((part) => part.startsWith('.env'))) {
                    throw new Error(`SYMLINK_TARGET_OUTSIDE_PATCHES: ${name}`);
                }
                const targetStat = lstatSync(resolved);
                if (!targetStat.isFile()) throw new Error(`SYMLINK_TARGET_NOT_REGULAR_FILE: ${name}`);
                const actual = relative(realpathSync(root), realpathSync(resolved));
                if (isAbsolute(actual) || actual === '..' || actual.startsWith(`..${sep}`)) {
                    throw new Error(`SYMLINK_ESCAPE: ${name}`);
                }
                files.push({ path: name, target, mode: stat.mode & 0o777,
                    targetMode: targetStat.mode & 0o777, sha256: sha256(readFile(resolved)) });
            } else if (stat.isDirectory()) {
                walk(fullPath);
            } else if (stat.isFile()) {
                files.push({ path: name, mode: stat.mode & 0o777, sha256: sha256(readFile(fullPath)) });
            } else throw new Error(`UNSUPPORTED_TREE_ENTRY: ${name}`);
        }
    }
    walk(directory);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, sha256: sha256(JSON.stringify(files)) };
}

export function inventoryMigrations(root, directory) {
    const tree = inventoryTree(root, directory);
    const entries = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const migration = join(directory, entry.name);
            const sql = inventoryFile(root, relative(root, join(migration, 'migration.sql')));
            return { name: entry.name, hasSql: sql.state === 'present',
                inventory: inventoryTree(root, migration) };
        }).sort((a, b) => a.name.localeCompare(b.name));
    return { entries, complete: entries.length > 0 && entries.every((entry) => entry.hasSql),
        sha256: sha256(JSON.stringify({ tree: tree.sha256, entries })) };
}
