import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [metadataFile, destination] = process.argv.slice(2);
if (!metadataFile || !destination) throw new Error('Usage: node ai-team-bundle-manifest.mjs <esbuild-meta> <manifest>');
const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const inputs = Object.keys(metadata.inputs).sort().map((name) => ({
  path: name, sha256: sha256(resolve(name)),
}));
const outputs = Object.entries(metadata.outputs).sort(([left], [right]) => left.localeCompare(right))
  .map(([name, output]) => ({ path: realpathSync(name), sha256: sha256(name),
    externalImports: output.imports.filter((item) => item.external).map((item) => item.path).sort() }));
writeFileSync(destination, `${JSON.stringify({ format: 'esbuild-input-output-sha256-v1', inputs, outputs }, null, 2)}\n`,
  { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ inputCount: inputs.length, outputCount: outputs.length,
  outputSha256: outputs.map((item) => item.sha256) }));
