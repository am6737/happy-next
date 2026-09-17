import { describe, expect, it } from 'vitest';
import { createReducer, reducer } from './reducer';
import type { NormalizedMessage } from '../typesRaw';
import type { AgentState } from '../storageTypes';

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

// The image preview addresses the CLI's registered file by the provider call id, and any tool call
// can be the one reading a picture — Read included.
describe('tool call identity', () => {
    it('carries the provider call ID on every tool, not just image tools', () => {
        const state = createReducer();
        const result = reducer(state, [{
            id: 'message-1', localId: null, createdAt: 1000, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', id: 'read-1', name: 'Read', input: { file_path: '/tmp/photo.png' }, description: null, uuid: 'tool-uuid', parentUUID: null }],
        }]);
        expect(result.messages[0]).toMatchObject({ kind: 'tool-call', tool: { callId: 'read-1', name: 'Read' } });
    });

    it('fills the call ID on a message the permission request created first', () => {
        const state = createReducer();
        const agentState: AgentState = {
            requests: {
                'read-1': { tool: 'Read', arguments: { file_path: '/tmp/photo.png' }, createdAt: 1000 },
            },
        };
        const pending = reducer(state, [], agentState);
        expect(pending.messages[0]).toMatchObject({ kind: 'tool-call', tool: { name: 'Read', state: 'running' } });

        const result = reducer(state, [{
            id: 'message-1', localId: null, createdAt: 2000, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', id: 'read-1', name: 'Read', input: { file_path: '/tmp/photo.png' }, description: null, uuid: 'tool-uuid', parentUUID: null }],
        }]);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]).toMatchObject({ kind: 'tool-call', tool: { callId: 'read-1', state: 'running' } });
    });
});
