import assert from 'node:assert/strict';
import { createStructuredModelHandler } from '../packages/happy-cli/src/daemon/structuredModel';
import { AiCoordinatorContextSchema, AiCoordinatorDecisionSchema } from '../packages/happy-wire/src/aiCoordinator';
import { buildCoordinatorPrompt } from '../packages/happy-server/sources/app/ai/coordinatorPrompt';

// Real configured pure HTTP provider; reuse the actual server prompt builder,
// not an instruction to echo a ready-made expected answer. No raw reply/auth
// or user repository content is printed.
const context = AiCoordinatorContextSchema.parse({ version: 1, conversationId: 'owned-conversation',
    history: [], currentWorkItems: [{ id: 'owned-work', title: 'Calculator', status: 'working',
        assigneeId: 'owned-alice', requirements: 'Build a calculator.' }],
    availableAgents: [{ id: 'owned-alice', name: 'Alice', teamIds: ['owned-team'], enabled: true, allowDelegation: true },
        { id: 'owned-bob', name: 'Bob', teamIds: ['owned-team'], enabled: true, allowDelegation: false }],
    pendingClarification: null, project: null });
const cases = [
    { intent: 'chat', text: '你好！今天只想聊一下，不要创建或修改任务。' },
    { intent: 'clarify', text: '帮我做个应用。我还没有确定需求，请先问我几个可选方向。' },
    { intent: 'create_task', text: '这是一个独立新需求：请让 Alice 给计算器添加整数相加功能，提交代码和测试。不要修改已有任务。' },
    { intent: 'update_task', text: '继续 owned-work，追加验收要求：整数相加支持负数。只更新这个已有任务，不要新建。' },
    { intent: 'delegate', text: '请为 owned-work 提出分工方案：Alice 实现相加，Bob 编写测试。先输出委派提议，不声称执行完成。' },
];
const handler = createStructuredModelHandler();
const evidence: Array<{ expected: string; schemaAccepted: boolean; actualIntent: string | null }> = [];
try {
    for (const item of cases) {
        const prompt = buildCoordinatorPrompt({ context, messageId: 'owned-message', text: item.text });
        const result = await handler.handle({ prompt, timeoutMs: 25000, maxResponseBytes: 65536 });
        assert.equal(result.success, true, 'Configured pure inference failed before protocol validation');
        if (!result.success) throw new Error('PURE_MODEL_UNAVAILABLE');
        let parsed: unknown; try { parsed = JSON.parse(result.text); } catch { parsed = null; }
        const decision = AiCoordinatorDecisionSchema.safeParse(parsed);
        evidence.push({ expected: item.intent, schemaAccepted: decision.success,
            actualIntent: decision.success ? decision.data.intent : null });
        if (decision.success && 'source' in decision.data) {
            assert.deepEqual(decision.data.source, { conversationId: context.conversationId, messageId: 'owned-message' },
                'Coordinator fabricated source identity');
        }
        if (decision.success && decision.data.intent === 'create_task') {
            assert.equal(decision.data.assigneeId, 'owned-alice');
        }
        if (decision.success && (decision.data.intent === 'update_task' || decision.data.intent === 'delegate')) {
            assert.equal(decision.data.targetWorkItemId, 'owned-work');
        }
        if (decision.success && decision.data.intent === 'delegate') {
            assert.deepEqual(new Set(decision.data.tasks.map((task) => task.assigneeId)), new Set(['owned-alice', 'owned-bob']));
        }
        console.log(JSON.stringify({ result: 'REAL_COORDINATOR_PROTOCOL_CASE', ...evidence.at(-1) }));
    }
    assert.ok(evidence.every((item) => item.schemaAccepted && item.expected === item.actualIntent),
        'Current server prompt failed real shared Coordinator decision protocol');
    console.log('REAL_PURE_HTTP_COORDINATOR_FIVE_DECISION_PROTOCOL_OK');
} finally { handler.cancelAll(); }
