import type { AiCoordinatorContext } from 'happy-wire';

export function buildCoordinatorPrompt(input: {
    context: AiCoordinatorContext;
    messageId: string;
    text: string;
    clarificationId?: string;
}): string {
    const { context, messageId, text, clarificationId } = input;
    const source = { conversationId: context.conversationId, messageId,
        ...(clarificationId ? { clarificationId } : {}) };
    const shape = [
        { intent: 'chat', response: 'A direct answer to the user.' },
        { intent: 'clarify', requirements: 'Current request', question: 'A specific question',
            options: ['First choice', 'Second choice'], candidateAgentIds: [] },
        { intent: 'create_task', title: 'Short title', requirements: 'Work and acceptance criteria',
            assigneeId: 'ID from availableAgents', source },
        { intent: 'update_task', targetWorkItemId: 'ID from currentWorkItems',
            requirements: 'Requested change', source },
        { intent: 'delegate', targetWorkItemId: 'ID from currentWorkItems',
            delegationKey: 'Stable proposal key', tasks: [{ taskKey: 'Unique task key',
                title: 'Short title', requirements: 'Work and acceptance criteria',
                assigneeId: 'ID from availableAgents', dependsOn: [] }], source },
    ];
    return `Return exactly one JSON object, no markdown or extra keys. Choose one of these five intents and include every shown field. The examples show the required JSON shape; replace descriptive strings with real values.\n${shape.map((item) => JSON.stringify(item)).join('\n')}\nUse only IDs present in context. A delegate proposal does not execute delegation; an authorized Leader execution API is required. source must exactly match the supplied source object.\nSource: ${JSON.stringify(source)}\nContext: ${JSON.stringify(context)}\nNew message: ${text.slice(0, 2_000)}`;
}
