import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeammateSkillInfo } from 'happy-wire';
import { listMachineSkills, syncTeammateSkills, type SkillFileSystem } from './skills';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'happy-skills-'));
    roots.push(root);
    return root;
}

async function makeSkill(root: string, directory: string, name: string, description = 'A useful skill'): Promise<string> {
    const skillDir = join(root, directory);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nNever returned by discovery.`);
    return skillDir;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('listMachineSkills', () => {
    it('deduplicates sources by Claude, agents, then Codex priority and filters unsafe entries', async () => {
        const root = await tempRoot();
        const homeDir = join(root, 'machine');
        const agentHome = join(root, 'agent');
        spawnSync('git', ['init', '--quiet'], { cwd: root });
        await makeSkill(homeDir, '.claude/skills/shared', 'shared', 'Claude wins');
        await makeSkill(homeDir, '.claude/skills/claude-only', 'claude-only', 'C'.repeat(2500));
        await makeSkill(homeDir, '.claude/skills/invalid', '../unsafe');
        await makeSkill(homeDir, '.claude/skills/no-frontmatter', 'missing-frontmatter');
        await writeFile(join(homeDir, '.claude/skills/no-frontmatter/SKILL.md'), '# no metadata');
        await makeSkill(homeDir, '.agents/skills/shared-agents', 'shared', 'Agents lose');
        await makeSkill(homeDir, '.agents/skills/agents-only', 'agents-only');
        await makeSkill(root, '.codex/skills/shared-codex', 'shared', 'Codex loses');
        await makeSkill(root, '.codex/skills/codex-only', 'codex-only');
        const excluded = await makeSkill(agentHome, 'materialised', 'excluded');
        await mkdir(join(homeDir, '.claude/skills'), { recursive: true });
        await symlink(excluded, join(homeDir, '.claude/skills/excluded'), 'dir');

        const skills = listMachineSkills({ homeDir, agentHome });
        expect(skills).toHaveLength(4);
        expect(skills.map(skill => skill.name)).toEqual(expect.arrayContaining(['shared', 'claude-only', 'agents-only', 'codex-only']));
        expect(skills.find(skill => skill.name === 'shared')?.source).toBe('claude');
        expect(skills.find(skill => skill.name === 'agents-only')?.source).toBe('agents');
        expect(skills.find(skill => skill.name === 'codex-only')?.source).toBe('codex');
        expect(skills.find(skill => skill.name === 'claude-only')?.description).toHaveLength(2000);
    });
});

describe('syncTeammateSkills', () => {
    it('creates both links, is idempotent, removes only manifest entries, and reports missing names', async () => {
        const root = await tempRoot();
        const source = await makeSkill(root, 'source/alpha', 'alpha');
        const home = join(root, 'agent');
        const catalog: TeammateSkillInfo[] = [{ name: 'alpha', description: 'A', source: 'claude', scope: 'USER', path: join(source, 'SKILL.md') }];
        await expect(syncTeammateSkills(home, ['alpha'], catalog)).resolves.toEqual({ linked: ['alpha'], missing: [] });
        expect((await lstat(join(home, '.claude/skills/alpha'))).isSymbolicLink()).toBe(true);
        expect(await readlink(join(home, '.agents/skills/alpha'))).toBe(source);
        const manifest = JSON.parse(await readFile(join(home, 'state/managed-skills.json'), 'utf8'));
        expect(manifest).toEqual({ managed: ['alpha'], missing: [] });
        await expect(syncTeammateSkills(home, ['alpha'], catalog)).resolves.toEqual({ linked: ['alpha'], missing: [] });

        await mkdir(join(home, '.claude/skills/foreign'), { recursive: true });
        await writeFile(join(home, '.claude/skills/foreign/SKILL.md'), 'owner file');
        await expect(syncTeammateSkills(home, ['missing'], catalog)).resolves.toEqual({ linked: [], missing: ['missing'] });
        expect(await lstat(join(home, '.claude/skills/alpha')).then(() => false, () => true)).toBe(true);
        expect(await lstat(join(home, '.claude/skills/foreign'))).toBeTruthy();
        expect(JSON.parse(await readFile(join(home, 'state/managed-skills.json'), 'utf8'))).toEqual({ managed: [], missing: ['missing'] });
    });

    it('falls back to recursive copy when symlinks fail', async () => {
        const root = await tempRoot();
        const source = await makeSkill(root, 'source/copy', 'copy');
        const home = join(root, 'agent');
        const catalog: TeammateSkillInfo[] = [{ name: 'copy', description: 'A', source: 'agents', scope: 'USER', path: join(source, 'SKILL.md') }];
        const fs: SkillFileSystem = {
            symlink: vi.fn(async () => { throw Object.assign(new Error('symlink denied'), { code: 'EPERM' }); }),
            cp,
        };
        await expect(syncTeammateSkills(home, ['copy'], catalog, fs)).resolves.toEqual({ linked: ['copy'], missing: [] });
        expect((await lstat(join(home, '.claude/skills/copy'))).isDirectory()).toBe(true);
        expect((await lstat(join(home, '.agents/skills/copy'))).isDirectory()).toBe(true);
        await syncTeammateSkills(home, ['copy'], catalog, fs);
        expect(fs.symlink).toHaveBeenCalledTimes(2);
    });
});
