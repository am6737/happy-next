const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') {
    process.exit(0);
}

const projectRoot = path.resolve(__dirname, '../..');
const iconName = 'HappyNext';
const source = path.join(projectRoot, 'src-tauri', 'icons', `${iconName}.icon`);
const output = path.join(projectRoot, 'src-tauri', 'icons', 'generated');
const catalog = path.join(output, 'Assets.car');
const partialPlist = path.join(output, 'partial.plist');
const generatedFallback = path.join(output, `${iconName}.icns`);

const versionOutput = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' });
const versionMatch = /^Xcode\s+(\d+)/m.exec(versionOutput);
if (Number(versionMatch?.[1] ?? 0) < 26) {
    throw new Error(`Building the macOS adaptive icon requires Xcode 26 or later; found ${versionOutput.trim()}.`);
}

fs.rmSync(output, { force: true, recursive: true });
fs.mkdirSync(output, { recursive: true });

execFileSync('xcrun', [
    'actool',
    source,
    '--compile', output,
    '--output-partial-info-plist', partialPlist,
    '--app-icon', iconName,
    '--enable-on-demand-resources', 'NO',
    '--target-device', 'mac',
    '--minimum-deployment-target', '12.0',
    '--platform', 'macosx',
], { stdio: 'inherit' });

if (!fs.existsSync(catalog)) {
    throw new Error(`actool did not produce the expected asset catalog at ${catalog}.`);
}

for (const intermediate of [partialPlist, generatedFallback]) {
    if (fs.existsSync(intermediate)) {
        fs.unlinkSync(intermediate);
    }
}

console.log(`Compiled macOS 26 adaptive icon to ${path.relative(projectRoot, catalog)}.`);
