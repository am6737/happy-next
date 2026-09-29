import { getModelCatalog } from 'happy-wire';

/**
 * Codex package spec to run, e.g. `@openai/codex@x.y.z`. HAPPY_CODEX_PACKAGE
 * overrides it; otherwise it comes from the active model catalog (`codexCli`),
 * which the server can update without a CLI release. Read it when spawning so
 * a freshly fetched catalog applies to the next Codex process.
 */
export function codexPackage(): string {
    const { package: name, version } = getModelCatalog().codexCli;
    return process.env.HAPPY_CODEX_PACKAGE ?? `${name}@${version}`;
}
