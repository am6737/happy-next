import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readArtifactContext, verifyFreshArtifactBinding } from './aiTeamProductionArtifactBinding.mjs';

// The controller remains in the source checkout. Product modules and package
// resolution must come from the verified fresh tree when a context is present.
export function resolveProductionRuntime(sourceRoot, contextFile) {
    const source = resolve(sourceRoot);
    if (!contextFile) return { sourceRoot: source, runtimeRoot: source,
        artifactContextSha256: null, binding: null };
    const context = readArtifactContext(contextFile, source);
    const binding = verifyFreshArtifactBinding(source, context);
    assert.equal(binding.contextSha256, context.contextSha256);
    return { sourceRoot: source, runtimeRoot: binding.artifactRoot,
        artifactContextSha256: context.contextSha256, binding };
}

export function productionModule(runtimeRoot, relativePath) {
    assert.match(relativePath, /^packages\/(?:happy-server|happy-cli)\/[A-Za-z0-9_./-]+$/);
    assert.ok(!relativePath.split('/').includes('..'));
    return pathToFileURL(join(runtimeRoot, relativePath)).href;
}
