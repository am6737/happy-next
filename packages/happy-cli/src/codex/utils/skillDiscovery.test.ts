import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverCodexSkills } from './skillDiscovery';

const createdDirs: string[] = [];

function createTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'codex-skills-'));
    createdDirs.push(dir);
    return dir;
}

function writeSkill(root: string, dirName: string, name: string): string {
    const skillDir = join(root, 'skills', dirName);
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---\nname: ${name}\ndescription: Test skill\n---\n`, 'utf8');
    return skillPath;
}

afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('discoverCodexSkills', () => {
    it.each([
        ['folded', '>', 'The fallback workflow for authoring custom HyperFrames videos at any length.'],
        ['folded-strip', '>-', 'The fallback workflow for authoring custom HyperFrames videos at any length.'],
        ['literal', '|', 'The fallback workflow for authoring custom HyperFrames videos at any length.'],
    ])('parses %s YAML block descriptions as a single-line summary', (_label, indicator, expected) => {
        const homeDir = createTempDir();
        const codexHome = createTempDir();
        const cwd = join(homeDir, 'project');
        const skillDir = join(codexHome, 'skills', 'video');
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
            join(skillDir, 'SKILL.md'),
            `---\nname: video\ndescription: ${indicator}\n  The fallback workflow for authoring custom\n  HyperFrames videos at any length.\n---\n`,
            'utf8',
        );

        const skills = discoverCodexSkills(cwd, homeDir, { CODEX_HOME: codexHome });

        expect(skills).toContainEqual(expect.objectContaining({
            name: 'video',
            description: expected,
        }));
    });

    it('parses nested OpenAI UI metadata with YAML syntax', () => {
        const homeDir = createTempDir();
        const codexHome = createTempDir();
        const cwd = join(homeDir, 'project');
        const skillPath = writeSkill(codexHome, 'video', 'video');
        const agentsDir = join(dirname(skillPath), 'agents');
        mkdirSync(agentsDir, { recursive: true });
        writeFileSync(
            join(agentsDir, 'openai.yaml'),
            'interface:\n  display_name: "Video: General"\n  short_description: >-\n    Author custom HyperFrames\n    video compositions\n',
            'utf8',
        );

        const skills = discoverCodexSkills(cwd, homeDir, { CODEX_HOME: codexHome });

        expect(skills).toContainEqual(expect.objectContaining({
            name: 'video',
            displayName: 'Video: General',
            shortDescription: 'Author custom HyperFrames video compositions',
        }));
    });

    it('discovers user and system skills from CODEX_HOME', () => {
        const homeDir = createTempDir();
        const codexHome = createTempDir();
        const cwd = join(homeDir, 'project');
        mkdirSync(cwd, { recursive: true });
        writeSkill(codexHome, 'orchestrator', 'orchestrator');
        writeSkill(join(homeDir, '.codex'), 'default-only', 'default-only');
        const systemDir = join(codexHome, 'skills', '.system', 'system-test');
        mkdirSync(systemDir, { recursive: true });
        writeFileSync(join(systemDir, 'SKILL.md'), '---\nname: system-test\ndescription: System test\n---\n');

        const skills = discoverCodexSkills(cwd, homeDir, { CODEX_HOME: codexHome });

        expect(skills).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'orchestrator', scope: 'USER' }),
            expect.objectContaining({ name: 'system-test', scope: 'SYSTEM' }),
        ]));
        expect(skills.some(skill => skill.name === 'default-only')).toBe(false);
    });

    it('accepts a disabled skill directory path in CODEX_HOME/config.toml', () => {
        const homeDir = createTempDir();
        const codexHome = createTempDir();
        const cwd = join(homeDir, 'project');
        mkdirSync(cwd, { recursive: true });
        const skillPath = writeSkill(codexHome, 'orchestrator', 'orchestrator');
        writeFileSync(
            join(codexHome, 'config.toml'),
            `[[skills.config]]\npath = ${JSON.stringify(dirname(skillPath))}\nenabled = false\n`,
            'utf8',
        );

        const skills = discoverCodexSkills(cwd, homeDir, { CODEX_HOME: codexHome });

        expect(skills.some(skill => skill.name === 'orchestrator')).toBe(false);
    });

    it('reads disabled skill configuration from CODEX_HOME/config.toml', () => {
        const homeDir = createTempDir();
        const codexHome = createTempDir();
        const cwd = join(homeDir, 'project');
        mkdirSync(cwd, { recursive: true });
        const skillPath = writeSkill(codexHome, 'orchestrator', 'orchestrator');
        writeFileSync(
            join(codexHome, 'config.toml'),
            `[[skills.config]]\npath = ${JSON.stringify(skillPath)}\nenabled = false\n`,
            'utf8',
        );

        const skills = discoverCodexSkills(cwd, homeDir, { CODEX_HOME: codexHome });

        expect(skills.some(skill => skill.name === 'orchestrator')).toBe(false);
    });
});
