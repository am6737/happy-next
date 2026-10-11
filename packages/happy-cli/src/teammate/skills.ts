import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
    TEAMMATE_SKILL_NAME_REGEX,
    type TeammateSkillInfo,
} from 'happy-wire';
import { discoverCodexSkills } from '@/codex/utils/skillDiscovery';
import { parseMarkdownFrontmatter, readYamlString } from '@/utils/yaml';

export interface MachineSkillRoots {
    homeDir?: string;
    agentHome?: string;
}

export type SkillFileSystem = {
    symlink: typeof symlink;
    cp: typeof cp;
};

const defaultFileSystem: SkillFileSystem = { symlink, cp };

function normalizedPath(path: string): string {
    return resolve(path);
}

function isInside(path: string, root: string): boolean {
    const child = relative(root, path);
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function isExcluded(path: string, agentHome: string | undefined): boolean {
    if (!agentHome) return false;
    const candidate = resolvedPathSync(path);
    const root = resolvedPathSync(agentHome);
    return isInside(candidate, root);
}

function resolvedPathSync(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return normalizedPath(path);
    }
}

function truncateDescription(description: string): string {
    return description.slice(0, 2000);
}

function readSkill(skillDir: string, source: TeammateSkillInfo['source'], scope: TeammateSkillInfo['scope']): TeammateSkillInfo | null {
    const skillPath = join(skillDir, 'SKILL.md');
    try {
        const markdown = readFileSync(skillPath, 'utf8');
        const frontmatter = parseMarkdownFrontmatter(markdown);
        const name = readYamlString(frontmatter?.name);
        const description = readYamlString(frontmatter?.description, true);
        if (!name || !description || !TEAMMATE_SKILL_NAME_REGEX.test(name)) return null;
        return { name, description: truncateDescription(description), source, scope, path: skillPath };
    } catch {
        return null;
    }
}

function scanRoot(root: string, source: TeammateSkillInfo['source'], scope: TeammateSkillInfo['scope'], agentHome?: string): TeammateSkillInfo[] {
    const result: TeammateSkillInfo[] = [];
    try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const skillDir = join(root, entry.name);
            if (isExcluded(skillDir, agentHome)) continue;
            const skill = readSkill(skillDir, source, scope);
            if (skill) result.push(skill);
        }
    } catch {
        // A missing or unreadable skills root is an empty source.
    }
    return result;
}

/** Lists metadata for skills available on this machine. Skill bodies never leave the machine. */
export function listMachineSkills(opts: MachineSkillRoots = {}): TeammateSkillInfo[] {
    const homeDir = opts.homeDir ?? os.homedir();
    const agentHome = opts.agentHome;
    const claude = scanRoot(join(homeDir, '.claude', 'skills'), 'claude', 'USER', agentHome);
    const agents = scanRoot(join(homeDir, '.agents', 'skills'), 'agents', 'USER', agentHome);
    const codexHome = opts.homeDir === undefined ? (process.env.CODEX_HOME || join(homeDir, '.codex')) : join(homeDir, '.codex');
    const codexEnv = { ...process.env, CODEX_HOME: codexHome };
    const codex = discoverCodexSkills(agentHome ?? process.cwd(), homeDir, codexEnv)
        .filter(skill => TEAMMATE_SKILL_NAME_REGEX.test(skill.name))
        .map(skill => ({
            name: skill.name,
            description: truncateDescription(skill.description),
            source: 'codex' as const,
            scope: skill.scope,
            path: skill.path,
        }))
        .filter(skill => !agentHome || !isInside(resolvedPathSync(skill.path), resolvedPathSync(agentHome)));

    const result: TeammateSkillInfo[] = [];
    const seen = new Set<string>();
    for (const skill of [...claude, ...agents, ...codex]) {
        if (seen.has(skill.name)) continue;
        seen.add(skill.name);
        result.push(skill);
    }
    return result;
}

interface ManagedSkillsManifest {
    managed: string[];
    missing: string[];
}

async function readManifest(path: string): Promise<ManagedSkillsManifest> {
    try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid manifest');
        const record = value as { managed?: unknown; missing?: unknown };
        return {
            managed: Array.isArray(record.managed) ? record.managed.filter((item): item is string => typeof item === 'string' && TEAMMATE_SKILL_NAME_REGEX.test(item)) : [],
            missing: Array.isArray(record.missing) ? record.missing.filter((item): item is string => typeof item === 'string' && TEAMMATE_SKILL_NAME_REGEX.test(item)) : [],
        };
    } catch {
        return { managed: [], missing: [] };
    }
}

async function removeEntry(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
}

async function targetExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

async function pointsTo(path: string, target: string): Promise<boolean> {
    try {
        return (await realpath(path)) === (await realpath(target));
    } catch {
        return false;
    }
}

async function validSkillTarget(path: string): Promise<string | null> {
    try {
        const skillPath = await realpath(path);
        const skillDir = dirname(skillPath);
        const directory = await stat(skillDir);
        const manifest = await stat(join(skillDir, 'SKILL.md'));
        return directory.isDirectory() && manifest.isFile() ? skillDir : null;
    } catch {
        return null;
    }
}

async function materialize(target: string, source: string, managed: boolean, fs: SkillFileSystem): Promise<'linked' | 'foreign'> {
    if (await targetExists(target)) {
        if (await pointsTo(target, source)) return 'linked';
        if (managed) {
            try {
                if ((await lstat(target)).isDirectory() && (await stat(join(target, 'SKILL.md'))).isFile()) return 'linked';
            } catch {
                // A managed entry with an invalid copy is replaced below.
            }
        }
        if (!managed) return 'foreign';
        await removeEntry(target);
    }
    try {
        await fs.symlink(source, target, 'dir');
    } catch {
        await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true });
    }
    return 'linked';
}

async function writeManifest(path: string, manifest: ManagedSkillsManifest): Promise<void> {
    const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    try {
        await rename(temp, path);
    } finally {
        await rm(temp, { force: true });
    }
}

/** Materializes selected skill directories into both native Agent discovery roots. */
export async function syncTeammateSkills(
    home: string,
    names: string[],
    catalog: TeammateSkillInfo[],
    fs: SkillFileSystem = defaultFileSystem,
): Promise<{ linked: string[]; missing: string[] }> {
    const root = resolve(home);
    const claudeRoot = join(root, '.claude', 'skills');
    const agentsRoot = join(root, '.agents', 'skills');
    await mkdir(claudeRoot, { recursive: true });
    await mkdir(agentsRoot, { recursive: true });
    const stateDir = join(root, 'state');
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const manifestPath = join(stateDir, 'managed-skills.json');
    const previous = await readManifest(manifestPath);
    const selected = Array.from(new Set(names));
    const selectedSafe = selected.filter(name => TEAMMATE_SKILL_NAME_REGEX.test(name));
    const selectedSet = new Set(selectedSafe);
    const catalogByName = new Map<string, TeammateSkillInfo>();
    for (const skill of catalog) {
        if (!catalogByName.has(skill.name)) catalogByName.set(skill.name, skill);
    }
    const managed = new Set(previous.managed);

    for (const name of previous.managed) {
        if (selectedSet.has(name)) continue;
        await Promise.all([removeEntry(join(claudeRoot, name)), removeEntry(join(agentsRoot, name))]);
        managed.delete(name);
    }

    const linked: string[] = [];
    const missing: string[] = [];
    for (const name of selectedSafe) {
        const skill = catalogByName.get(name);
        const source = skill ? await validSkillTarget(skill.path) : null;
        if (!source) {
            missing.push(name);
            continue;
        }
        const wasManaged = managed.has(name);
        const results = await Promise.all([
            materialize(join(claudeRoot, name), source, wasManaged, fs),
            materialize(join(agentsRoot, name), source, wasManaged, fs),
        ]);
        if (results.some(result => result === 'linked' || result === 'foreign')) {
            linked.push(name);
            if (results.every(result => result === 'linked') || wasManaged) managed.add(name);
        }
    }

    await writeManifest(manifestPath, {
        managed: Array.from(managed).filter(name => selectedSet.has(name)).sort(),
        missing: Array.from(new Set(missing)).sort(),
    });
    return { linked, missing };
}

