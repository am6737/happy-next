const fs = require('node:fs');
const path = require('node:path');

function normalizeVersion(value) {
    const version = String(value || '').trim().replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`Invalid desktop update version: ${value}`);
    }
    return version;
}

function releaseUrl(repository, version, filename) {
    return `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(filename)}`;
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

function generateDesktopUpdateManifest({
    version: rawVersion,
    repository,
    artifactsDir,
    outputPath,
    notes = '',
    pubDate = new Date().toISOString(),
}) {
    const version = normalizeVersion(rawVersion);
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository || '')) {
        throw new Error('Repository must use the owner/name format');
    }

    const files = fs.readdirSync(artifactsDir).filter((file) => fs.statSync(path.join(artifactsDir, file)).isFile());
    const mac = findSignedArtifact(files, /\.app\.tar\.gz$/, 'macOS Universal');
    const windows = findSignedArtifact(files, /\.(?:nsis|msi)\.zip$/, 'Windows x64');

    const entry = ({ artifact, signatureFile }) => ({
        signature: fs.readFileSync(path.join(artifactsDir, signatureFile), 'utf8').trim(),
        url: releaseUrl(repository, version, artifact),
    });
    const macEntry = entry(mac);
    const windowsEntry = entry(windows);
    const manifest = {
        version,
        notes,
        pub_date: pubDate,
        platforms: {
            'darwin-aarch64': macEntry,
            'darwin-x86_64': macEntry,
            'windows-x86_64': windowsEntry,
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
        repository: args.repository,
        artifactsDir: path.resolve(args.artifacts),
        outputPath: path.resolve(args.output),
        notes: args.notes || '',
    });
}

module.exports = {
    generateDesktopUpdateManifest,
    normalizeVersion,
};
