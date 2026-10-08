import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inventoryTree } from '../../../scripts/aiTeamProductionTree.mjs';

const defaultEntry = '/tmp/happy-cli-template-runtime-ygeOx8/dist/index.mjs';
const defaultSha256 = '2ed8294601c4c42977160d796b144324f6d44901475f4d529ab5ea4c26d8d6f7';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function aiCliTestArtifact() {
    const suppliedEntry = process.env.HAPPY_TEST_CLI_ENTRY;
    const suppliedSha256 = process.env.HAPPY_TEST_CLI_SHA256;
    if (Boolean(suppliedEntry) !== Boolean(suppliedSha256)) {
        throw new Error('HAPPY_TEST_CLI_ENTRY and HAPPY_TEST_CLI_SHA256 must be supplied together');
    }
    const entry = resolve(suppliedEntry ?? defaultEntry);
    const expectedEntrySha256 = suppliedSha256 ?? defaultSha256;
    const expectedTreeSha256 = process.env.HAPPY_TEST_CLI_TREE_SHA256;
    const suppliedFileCount = process.env.HAPPY_TEST_CLI_FILE_COUNT;
    if (Boolean(expectedTreeSha256) !== Boolean(suppliedFileCount)) {
        throw new Error('HAPPY_TEST_CLI_TREE_SHA256 and HAPPY_TEST_CLI_FILE_COUNT must be supplied together');
    }
    const expectedFileCount = suppliedFileCount === undefined ? null : Number(suppliedFileCount);
    if (suppliedFileCount !== undefined
        && (!/^[1-9]\d*$/.test(suppliedFileCount) || !Number.isSafeInteger(expectedFileCount))) {
        throw new Error('HAPPY_TEST_CLI_FILE_COUNT must be a positive safe integer');
    }
    if (!/^[a-f0-9]{64}$/.test(expectedEntrySha256)
        || expectedTreeSha256 && !/^[a-f0-9]{64}$/.test(expectedTreeSha256)) {
        throw new Error('Invalid CLI artifact SHA-256');
    }
    if (expectedTreeSha256 && join(dirname(entry), 'index.mjs') !== entry) {
        throw new Error('Whole-tree pin requires a dist/index.mjs entry');
    }
    const verify = () => {
        if (sha256(readFileSync(entry)) !== expectedEntrySha256) {
            throw new Error('CLI entry SHA-256 changed');
        }
        if (expectedTreeSha256) {
            const dist = dirname(entry);
            const tree = inventoryTree(dirname(dist), dist);
            if (tree.files.length !== expectedFileCount) {
                throw new Error(`CLI dist file count changed: ${tree.files.length}`);
            }
            const repositoryPaths = tree.files.map((file) => ({
                ...file, path: `packages/happy-cli/${file.path}`,
            }));
            const legacyTreeSha256 = sha256(JSON.stringify(repositoryPaths));
            const formalFiles = repositoryPaths.map(({ path, sha256: fileSha256, mode }) => ({
                path, sha256: fileSha256, mode,
            })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
            const formalTreeSha256 = sha256(JSON.stringify(formalFiles));
            if (legacyTreeSha256 !== expectedTreeSha256
                && formalTreeSha256 !== expectedTreeSha256) {
                throw new Error('CLI dist tree SHA-256 changed');
            }
        }
    };
    verify();
    return { entry, entrySha256: expectedEntrySha256,
        treeSha256: expectedTreeSha256 ?? null, fileCount: expectedFileCount, verify };
}
