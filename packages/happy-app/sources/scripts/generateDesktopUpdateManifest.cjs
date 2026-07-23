const fs = require('node:fs');
const path = require('node:path');

function normalizeVersion(value) {
    const version = String(value || '').trim().replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`Invalid desktop update version: ${value}`);
    }
    return version;
}

function normalizeReleaseTag(value, version) {
    const tag = String(value || `v${version}`).trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag)) {
        throw new Error(`Invalid desktop release tag: ${value}`);
    }
    return tag;
}

function releaseUrl(repository, releaseTag, filename) {
    return `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(filename)}`;
}

function findSignedArtifact(files, matcher, label) {
    const artifact = files.find((file) => matcher.test(file) && !file.endsWith('.sig'));
    if (!artifact) {
        throw new Error(`Missing ${label} updater artifact`);
    }
    const signatureFile = `${artifact}.sig`;
    if (!files.includes(signatureFile)) {
        throw new Error(`Missing signature for ${artifact}`);
    }
    return { artifact, signatureFile };
}

function findWindowsUpdaterArtifact(files, architecture) {
    const architectureTokens = architecture === 'x64'
        ? ['_x64', '-x64', '_x86_64', '-x86_64']
        : ['_arm64', '-arm64', '_aarch64', '-aarch64'];
    for (const extension of ['.nsis.zip', '.msi.zip']) {
        const artifact = files.find((file) => {
            const normalized = file.toLowerCase();
            return normalized.endsWith(extension)
                && architectureTokens.some((token) => normalized.includes(token));
        });
        if (!artifact) {
            continue;
        }
        const signatureFile = `${artifact}.sig`;
        if (!files.includes(signatureFile)) {
            throw new Error(`Missing signature for ${artifact}`);
        }
        return { artifact, signatureFile };
    }
    throw new Error(`Missing Windows ${architecture} updater artifact`);
}

function generateDesktopUpdateManifest({
    version: rawVersion,
    releaseTag: rawReleaseTag,
    repository,
    artifactsDir,
    outputPath,
    notes = '',
    pubDate = new Date().toISOString(),
}) {
    const version = normalizeVersion(rawVersion);
    const releaseTag = normalizeReleaseTag(rawReleaseTag, version);
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository || '')) {
        throw new Error('Repository must use the owner/name format');
    }

    const files = fs.readdirSync(artifactsDir).filter((file) => fs.statSync(path.join(artifactsDir, file)).isFile());
    const mac = findSignedArtifact(files, /\.app\.tar\.gz$/, 'macOS Universal');
    const windowsX64 = findWindowsUpdaterArtifact(files, 'x64');
    const windowsArm64 = findWindowsUpdaterArtifact(files, 'arm64');

    const entry = ({ artifact, signatureFile }) => ({
        signature: fs.readFileSync(path.join(artifactsDir, signatureFile), 'utf8').trim(),
        url: releaseUrl(repository, releaseTag, artifact),
    });
    const macEntry = entry(mac);
    const windowsX64Entry = entry(windowsX64);
    const windowsArm64Entry = entry(windowsArm64);
    const manifest = {
        version,
        notes,
        pub_date: pubDate,
        platforms: {
            'darwin-aarch64': macEntry,
            'darwin-x86_64': macEntry,
            'windows-x86_64': windowsX64Entry,
            'windows-aarch64': windowsArm64Entry,
        },
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    return manifest;
}

function parseArguments(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid argument near ${key || '<end>'}`);
        }
        values[key.slice(2)] = value;
    }
    return values;
}

if (require.main === module) {
    const args = parseArguments(process.argv.slice(2));
    generateDesktopUpdateManifest({
        version: args.version,
        releaseTag: args['release-tag'],
        repository: args.repository,
        artifactsDir: path.resolve(args.artifacts),
        outputPath: path.resolve(args.output),
        notes: args['notes-file']
            ? fs.readFileSync(path.resolve(args['notes-file']), 'utf8').trim()
            : args.notes || '',
    });
}

module.exports = {
    generateDesktopUpdateManifest,
    normalizeReleaseTag,
    normalizeVersion,
};
