/**
 * Daily model catalog sync — entry point (`yarn workspace happy-wire sync-models`).
 *
 * Fetches the upstream model lists, merges them into modelCatalog.json and
 * writes the pull request body to the path given by `--report`. When run in
 * GitHub Actions it sets the `changed` output. A failing source is reported and
 * skipped; an invalid merged catalog, or one whose `codexCli` changed, aborts
 * the run without writing anything.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ModelCatalogSchema } from '../modelCatalogSchema';
import { fetchClaudeMetadata, fetchCodexModels, fetchGeminiCliModels } from './sources';
import { formatCatalogJson, formatSyncReport, hasCatalogChanges, syncCatalog } from './syncCatalog';

const catalogPath = fileURLToPath(new URL('../modelCatalog.json', import.meta.url));
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex === -1 ? null : process.argv[reportIndex + 1];

const sourceErrors: string[] = [];
async function fromSource<T>(name: string, load: () => Promise<T>): Promise<T | null> {
    try {
        return await load();
    } catch (error) {
        sourceErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

const current = ModelCatalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf-8')));
const codexPackage = `${current.codexCli.package}@${current.codexCli.version}`;

const [codex, claude, gemini] = await Promise.all([
    fromSource(`Codex CLI model/list (${codexPackage})`, () => fetchCodexModels(codexPackage)),
    fromSource('basellm/llm-metadata (Anthropic)', fetchClaudeMetadata),
    fromSource('Gemini CLI model list', fetchGeminiCliModels),
]);

const { catalog, report } = syncCatalog(current, { codex, claude, gemini });
ModelCatalogSchema.parse(catalog);
if (JSON.stringify(catalog.codexCli) !== JSON.stringify(current.codexCli)) {
    throw new Error('The sync must never change codexCli — the Codex CLI version is updated by hand.');
}

const changed = hasCatalogChanges(report);
if (changed) writeFileSync(catalogPath, formatCatalogJson(catalog));
const body = formatSyncReport(report, sourceErrors);
if (reportPath) writeFileSync(reportPath, body);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);

console.log(body);
console.log(changed ? '\nmodelCatalog.json updated.' : '\nNo catalog changes.');
