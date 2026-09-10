import { describe, expect, it } from 'vitest';
import { createReducer, reducer } from './reducer';
import type { NormalizedMessage } from '../typesRaw';

describe('view_image call identity', () => {
    it('preserves the real call ID through completion and replay', () => {
        const state = createReducer();
        const call: NormalizedMessage = {
            id: 'message-1', localId: 'codex-log:call-1', createdAt: 1000, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', id: 'call-1', name: 'view_image', input: { path: '/outside/image.png' }, description: null, uuid: 'tool-uuid', parentUUID: null }],
        };
        const result = reducer(state, [call]);
        expect(result.messages[0]).toMatchObject({ kind: 'tool-call', tool: { callId: 'call-1', name: 'view_image' } });
        const completed = reducer(state, [{
            id: 'message-2', localId: null, createdAt: 2000, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-result', tool_use_id: 'call-1', content: {}, is_error: false, uuid: 'result-uuid', parentUUID: null }],
        }]);
        expect(completed.messages[0]).toMatchObject({ tool: { callId: 'call-1', state: 'completed' } });
        const replayed = reducer(createReducer(), [call]);
        expect(replayed.messages[0]).toMatchObject({ tool: { callId: 'call-1' } });
    });
});
