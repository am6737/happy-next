import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeSlashCommandMetadata } from './slashCommandMetadata';

const createdDirs: string[] = [];

function createTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'claude-command-metadata-'));
    createdDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('buildClaudeSlashCommandMetadata', () => {
    it('parses a multiline YAML skill description as a single-line summary', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const skillDir = join(cwd, '.claude', 'skills', 'general-video');
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
            join(skillDir, 'SKILL.md'),
            '---\nname: general-video\ndescription: >\n  The fallback workflow for authoring custom\n  HyperFrames video compositions.\n---\n',
            'utf8',
        );

        const metadata = buildClaudeSlashCommandMetadata(
            { slashCommands: ['general-video'], skills: ['general-video'], cwd },
            { cwd, homeDir },
        );

        expect(metadata).toEqual([
            {
                name: 'general-video',
                description: 'The fallback workflow for authoring custom HyperFrames video compositions.',
                kind: 'skill',
                scope: 'REPO',
            },
        ]);
    });

    it('parses a multiline YAML slash-command description as a single-line summary', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const commandDir = join(cwd, '.claude', 'commands');
        mkdirSync(commandDir, { recursive: true });
        writeFileSync(
            join(commandDir, 'review.md'),
            '---\ndescription: |\n  Review the current changes:\n  report correctness and test gaps.\n---\n',
            'utf8',
        );

        const metadata = buildClaudeSlashCommandMetadata(
            { slashCommands: ['review'], cwd },
            { cwd, homeDir },
        );

        expect(metadata).toEqual([
            {
                name: 'review',
                description: 'Review the current changes: report correctness and test gaps.',
                kind: 'command',
                scope: 'REPO',
            },
        ]);
    });
});
