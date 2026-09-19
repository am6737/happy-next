import { describe, expect, it } from 'vitest';
import { getToolDescriptor } from './getToolDescriptor';
import { canAutoApproveForMode, canAutoApproveTool } from './permissionHandler';

// canAutoApproveForMode decides whether a tool that already reached our
// permission callback may be auto-approved purely from the permission mode.
// The key invariant under test: bypassPermissions must NOT short-circuit to
// allow here. The Claude CLI auto-approves everything it can on its own and
// only delegates to this callback the tools it won't decide (verified: it
// auto-runs Write under bypassPermissions but routes AskUserQuestion and
// ExitPlanMode through the callback). So anything reaching us under
// bypassPermissions is a user-interaction the user must resolve.
describe('canAutoApproveForMode', () => {
    it('never auto-approves under bypassPermissions, whatever the tool is', () => {
        // Interaction tools the CLI delegates under bypass.
        expect(canAutoApproveForMode('bypassPermissions', { edit: false })).toBe(false);
        // Even an edit tool: under bypass it would only reach us if the CLI
        // delegated it, so we still ask rather than silently allow.
        expect(canAutoApproveForMode('bypassPermissions', { edit: true })).toBe(false);
    });

    it('auto-approves edit tools under acceptEdits only', () => {
        expect(canAutoApproveForMode('acceptEdits', { edit: true })).toBe(true);
        expect(canAutoApproveForMode('acceptEdits', { edit: false })).toBe(false);
    });

    it('never auto-approves under default/plan/auto', () => {
        for (const mode of ['default', 'plan', 'auto'] as const) {
            expect(canAutoApproveForMode(mode, { edit: true })).toBe(false);
            expect(canAutoApproveForMode(mode, { edit: false })).toBe(false);
        }
    });
});

// canAutoApproveTool is the full policy the permission callback consults. On top of the
// mode rule, it exempts Happy's own UI tools: the app issues them and has no footer to
// approve them from, so asking deadlocks the turn - which means they must be exempt in
// *every* mode, plan included. The invariants under test: the exemption is those two tools
// by name (not the `mcp__happy__` namespace), it holds in all modes, and it widens nothing
// else.
const ALL_CLAUDE_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;

// Real descriptors, so the acceptEdits edit rule cannot leak onto a tool that is not an edit.
const approves = (tool: string, mode: typeof ALL_CLAUDE_MODES[number]) =>
    canAutoApproveTool(tool, mode, getToolDescriptor(tool));

describe('canAutoApproveTool', () => {
    it('exempts the two Happy UI tools in every mode', () => {
        for (const mode of ALL_CLAUDE_MODES) {
            expect(approves('mcp__happy__change_title', mode)).toBe(true);
            expect(approves('mcp__happy__preview_html', mode)).toBe(true);
        }
    });

    it('leaves the orchestrator tools asking, though they share the prefix', () => {
        for (const mode of ALL_CLAUDE_MODES) {
            expect(approves('mcp__happy__orchestrator_submit', mode)).toBe(false);
            expect(approves('mcp__happy__orchestrator_send_message', mode)).toBe(false);
        }
    });

    it('leaves interaction and machine tools asking in every mode', () => {
        for (const mode of ALL_CLAUDE_MODES) {
            expect(approves('AskUserQuestion', mode)).toBe(false);
            expect(approves('ExitPlanMode', mode)).toBe(false);
            expect(approves('Bash', mode)).toBe(false);
        }
    });

    it('still auto-approves edits under acceptEdits, and only there', () => {
        expect(approves('Edit', 'acceptEdits')).toBe(true);
        expect(approves('Edit', 'default')).toBe(false);
        expect(approves('Read', 'acceptEdits')).toBe(false);
    });
});
