import assert from 'node:assert/strict';
import { createStructuredModelHandler } from '../packages/happy-cli/src/daemon/structuredModel';

// Uses existing configured provider/model and reads credentials only inside the
// runtime handler. Prints neither credentials nor the model's raw output.
const handler = createStructuredModelHandler();
try {
    const result = await handler.handle({
        prompt: 'Return only a JSON object with exactly these two properties: "intent" equal to "chat", and "protocolVersion" equal to 1. Do not use any tools.',
        timeoutMs: 25000, maxResponseBytes: 65536,
    });
    assert.equal(result.success, true, 'Configured pure HTTP inference failed');
    if (!result.success) throw new Error('PURE_MODEL_UNAVAILABLE');
    const decision = JSON.parse(result.text);
    assert.deepEqual(decision, { intent: 'chat', protocolVersion: 1 });
    assert.deepEqual(Object.keys(result).sort(), ['success', 'text'], 'RPC leaked provider configuration');
    console.log('REAL_CONFIGURED_PROVIDER_PURE_HTTP_STRUCTURED_MODEL_OK');
} finally { handler.cancelAll(); }
