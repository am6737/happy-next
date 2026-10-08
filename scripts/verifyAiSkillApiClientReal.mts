import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApiClient } from '../packages/happy-cli/src/api/api';
import { installSkillBundle } from '../packages/happy-cli/src/orchestrator/skillBundle';
import { verifyAiSkillBundle } from './verifyAiSkillBundle.mjs';

// Invoked by the owned loopback fixture with isolated HAPPY_HOME_DIR. The
// fixture account ID serves only as its local authentication capability.
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(new URL(process.env.HAPPY_SERVER_URL!).hostname, '127.0.0.1');
const api = await ApiClient.create({ token: input.accountId,
    encryption: { type: 'legacy', secret: new Uint8Array(32) } });
const items = await api.getOrchestratorTaskSkills(input.taskId, input.executionId, input.dispatchToken);
assert.equal(items.length, 1);
const bundle = items[0];
assert.equal(bundle.skillId, input.manifest.skillId);
assert.equal(bundle.version, input.manifest.version);
assert.equal(bundle.hash, input.expectedHash);
const installed = installSkillBundle(input.installRoot, bundle, { skillId: bundle.skillId,
    version: bundle.version, hash: input.expectedHash });
assert.equal(verifyAiSkillBundle(installed, input.manifest).files, input.manifest.files.length);
console.log('REAL_CLI_API_SKILL_DOWNLOAD_AND_INSTALL_BYTES_OK');
