import { describe, expect, it } from 'vitest';
import { stripAttachmentsFromPrompt, userPromptText } from './userPrompt';

describe('userPromptText', () => {
    it('keeps what the user typed', () => {
        expect(userPromptText('Fix the build')).toBe('Fix the build');
        expect(userPromptText('Why does <orchestrator-callback> show up?')).toBe('Why does <orchestrator-callback> show up?');
    });

    it('leaves out the prompts Happy, the agent or its CLI wrote', () => {
        for (const text of [
            '<orchestrator-callback>\nRun "x" reached terminal state: completed.\n</orchestrator-callback>',
            '<task-notification>done</task-notification>',
            '<local-command-stdout>Compacted</local-command-stdout>',
            '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>',
            '<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>',
            '[Request interrupted by user for tool use]',
            '[Image: original 1080x2400, displayed at 900x2000. Multiply coordinates by 1.2 to map to original image.]',
            '[Image: source: /tmp/claude-1000/images/1.png]',
            'Base directory for this skill: /home/coder/.claude/skills/run\n\n# Run',
            '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>…</INSTRUCTIONS>',
            '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>',
            '<ide_opened_file>The user opened the file /repo/a.ts in the IDE.</ide_opened_file>',
            '<turn_aborted>The user interrupted.</turn_aborted>',
            '   ',
        ]) {
            expect(userPromptText(text)).toBeNull();
        }
    });

    it('shows a slash command as the user typed it', () => {
        expect(userPromptText('<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>')).toBe('/compact');
        expect(userPromptText('<command-message>orchestrator:codex</command-message>\n<command-name>/orchestrator:codex</command-name>\n<command-args>fix the tests</command-args>')).toBe('/orchestrator:codex fix the tests');
    });

    it('shows a shell command as the user typed it', () => {
        expect(userPromptText('<bash-input>git status</bash-input>')).toBe('! git status');
    });

    it('leaves attached files out', () => {
        expect(userPromptText('Look at this\n\n<attached-files>\nThe user attached these files to this message. Read them as needed:\n- /tmp/a.png\n</attached-files>')).toBe('Look at this');
    });
});

describe('stripAttachmentsFromPrompt', () => {
    it('keeps the block of a prompt that was only files', () => {
        const prompt = '<attached-files>\nThe user attached these files to this message. Read them as needed:\n- /tmp/a.png\n</attached-files>';
        expect(stripAttachmentsFromPrompt(prompt)).toBe(prompt);
    });
});
