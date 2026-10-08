import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyRegisteredRepo } from '../packages/happy-cli/src/orchestrator/registeredRepo';
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(new URL(process.env.HAPPY_SERVER_URL!).hostname, '127.0.0.1');
try {
    const result = await verifyRegisteredRepo(input.accountId, input.machineId, input.request);
    console.log(JSON.stringify(result));
} catch {
    // Fixture errors carry no raw request/auth/config values.
    console.log(JSON.stringify({ verified: false, errorCode: 'registered_repo_rejected' }));
}
