import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isYamlRecord, parseMarkdownFrontmatter, parseYamlRecord, readYamlString } from '@/utils/yaml';
import { getCodexHomeDir } from './codexHome';

export type CodexSkillScope = 'REPO' | 'USER' | 'ADMIN' | 'SYSTEM';

export interface CodexSkillMetadata {
    name: string;
    description: string;
    scope: CodexSkillScope;
    path: string;
    displayName?: string;
    shortDescription?: string;
}

export function getCodexSkillsSignature(skills: CodexSkillMetadata[]): string {
    return JSON.stringify(
        skills
            .map(skill => ({
                name: skill.name,
                description: skill.description,
                scope: skill.scope,
                path: normalizePath(skill.path),
                displayName: skill.displayName ?? null,
                shortDescription: skill.shortDescription ?? null,
            }))
            .sort((a, b) => {
                const scopeCompare = a.scope.localeCompare(b.scope);
                if (scopeCompare !== 0) return scopeCompare;
                const pathCompare = a.path.localeCompare(b.path);
                if (pathCompare !== 0) return pathCompare;
                return a.name.localeCompare(b.name);
            })
    );
}

function findGitRoot(cwd: string): string {
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd,
            encoding: 'utf8',
            timeout: 1000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || cwd;
    } catch {
        return cwd;
    }
}

function collectAncestors(from: string, until: string): string[] {
    const result: string[] = [];
    let current = resolve(from);
    const stop = resolve(until);

    while (true) {
        result.push(current);
        if (current === stop) break;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }

    return result;
}

function parseOpenAiYaml(skillDir: string): Pick<CodexSkillMetadata, 'displayName' | 'shortDescription'> {
    const metadataPath = join(skillDir, 'agents', 'openai.yaml');

    try {
        const yaml = readFileSync(metadataPath, 'utf8');
        const parsed = parseYamlRecord(yaml);
        const values = parsed && isYamlRecord(parsed.interface) ? parsed.interface : parsed;
        const displayName = readYamlString(values?.display_name, true);
        const shortDescription = readYamlString(values?.short_description, true);
        const result: Pick<CodexSkillMetadata, 'displayName' | 'shortDescription'> = {};
        if (displayName) result.displayName = displayName;
        if (shortDescription) result.shortDescription = shortDescription;
        return result;
    } catch {
        return {};
    }
}

function readSkill(skillDir: string, scope: CodexSkillScope): CodexSkillMetadata | null {
    const skillPath = join(skillDir, 'SKILL.md');

    try {
        const markdown = readFileSync(skillPath, 'utf8');
        const frontmatter = parseMarkdownFrontmatter(markdown);
        const name = readYamlString(frontmatter?.name);
        const description = readYamlString(frontmatter?.description, true);
        if (!name || !description) return null;

        const uiMetadata = parseOpenAiYaml(skillDir);
        return {
            name,
            description,
            scope,
            path: skillPath,
            ...uiMetadata,
        };
    } catch {
        return null;
    }
}

function scanSkillRoot(root: string, scope: CodexSkillScope, includeDotDirs = true): CodexSkillMetadata[] {
    const skills: CodexSkillMetadata[] = [];
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            if (!includeDotDirs && entry.name.startsWith('.')) continue;

            const skillDir = join(root, entry.name);
            const skill = readSkill(skillDir, scope);
            if (skill) {
                skills.push(skill);
            }
        }
    } catch {
    }

    return skills;
}

function normalizePath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return resolve(path);
    }
}

function readDisabledSkillPaths(codexHomeDir: string): Set<string> {
    const disabled = new Set<string>();
    const configPath = join(codexHomeDir, 'config.toml');

    try {
        const config = readFileSync(configPath, 'utf8');
        const blocks = config.split(/\[\[skills\.config\]\]/g).slice(1);
        for (const block of blocks) {
            const path = block.match(/^\s*path\s*=\s*["'](.+?)["']\s*$/m)?.[1];
            const enabled = block.match(/^\s*enabled\s*=\s*(true|false)\s*$/m)?.[1];
            if (path && enabled === 'false') {
                disabled.add(normalizePath(path));
            }
        }
    } catch {
    }

    return disabled;
}

interface EnabledPlugin {
    name: string;
    marketplace: string;
}

function readEnabledPlugins(codexHomeDir: string): EnabledPlugin[] {
    const configPath = join(codexHomeDir, 'config.toml');

    try {
        const config = readFileSync(configPath, 'utf8');
        const plugins: EnabledPlugin[] = [];
        const sectionPattern = /^\s*\[plugins\."((?:\\.|[^"\\])+)"\]\s*$/gm;
        const sections = [...config.matchAll(sectionPattern)];

        for (let index = 0; index < sections.length; index++) {
            const section = sections[index];
            const pluginId = section[1].replace(/\\([\\"])/g, '$1');
            const separator = pluginId.lastIndexOf('@');
            if (separator <= 0 || separator === pluginId.length - 1) continue;

            const bodyStart = (section.index ?? 0) + section[0].length;
            const nextSection = config.slice(bodyStart).match(/^\s*\[[^\]]+\]\s*$/m);
            const bodyEnd = nextSection?.index === undefined
                ? config.length
                : bodyStart + nextSection.index;
            const body = config.slice(bodyStart, bodyEnd);
            if (!/^\s*enabled\s*=\s*true\s*(?:#.*)?$/m.test(body)) continue;

            plugins.push({
                name: pluginId.slice(0, separator),
                marketplace: pluginId.slice(separator + 1),
            });
        }

        return plugins;
    } catch {
        return [];
    }
}

function findPluginInstallDir(codexHomeDir: string, plugin: EnabledPlugin): string | null {
    const pluginRoot = join(codexHomeDir, 'plugins', 'cache', plugin.marketplace, plugin.name);

    try {
        const candidates = readdirSync(pluginRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
            .map(entry => join(pluginRoot, entry.name))
            .filter(candidate => {
                try {
                    const manifest = JSON.parse(readFileSync(join(candidate, '.codex-plugin', 'plugin.json'), 'utf8')) as unknown;
                    return typeof manifest === 'object'
                        && manifest !== null
                        && 'name' in manifest
                        && manifest.name === plugin.name;
                } catch {
                    return false;
                }
            })
            .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

        return candidates[0] ?? null;
    } catch {
        return null;
    }
}

function discoverPluginSkills(codexHomeDir: string): CodexSkillMetadata[] {
    const skills: CodexSkillMetadata[] = [];

    for (const plugin of readEnabledPlugins(codexHomeDir)) {
        const pluginDir = findPluginInstallDir(codexHomeDir, plugin);
        if (!pluginDir) continue;

        try {
            const manifest = JSON.parse(readFileSync(join(pluginDir, '.codex-plugin', 'plugin.json'), 'utf8')) as {
                skills?: unknown;
            };
            if (typeof manifest.skills !== 'string') continue;

            const skillRoot = resolve(pluginDir, manifest.skills);
            // Keep plugin skills in the USER scope for compatibility with Happy clients
            // released before plugin discovery was added. Their skill schema does not accept
            // PLUGIN even though slash-command metadata does.
            for (const skill of scanSkillRoot(skillRoot, 'USER')) {
                skills.push({
                    ...skill,
                    name: skill.name.startsWith(`${plugin.name}:`)
                        ? skill.name
                        : `${plugin.name}:${skill.name}`,
                });
            }
        } catch {
        }
    }

    return skills;
}

function pushUniqueRoot(roots: string[], root: string): void {
    try {
        const normalized = realpathSync(root);
        if (!roots.includes(normalized)) roots.push(normalized);
    } catch {
        const normalized = resolve(root);
        if (!roots.includes(normalized)) roots.push(normalized);
    }
}

export function discoverCodexSkills(
    cwd = process.cwd(),
    homeDir = os.homedir(),
    env: NodeJS.ProcessEnv = process.env,
): CodexSkillMetadata[] {
    const skills: CodexSkillMetadata[] = [];
    const codexHomeDir = getCodexHomeDir(homeDir, env);
    const disabledSkillPaths = readDisabledSkillPaths(codexHomeDir);

    const repoRoot = findGitRoot(cwd);
    const repoSkillRoots: string[] = [];
    for (const ancestor of collectAncestors(cwd, repoRoot)) {
        pushUniqueRoot(repoSkillRoots, join(ancestor, '.agents', 'skills'));
        pushUniqueRoot(repoSkillRoots, join(ancestor, '.codex', 'skills'));
    }
    for (const root of repoSkillRoots) {
        skills.push(...scanSkillRoot(root, 'REPO'));
    }

    skills.push(...scanSkillRoot(join(homeDir, '.agents', 'skills'), 'USER'));
    skills.push(...scanSkillRoot(join(codexHomeDir, 'skills'), 'USER', false));
    skills.push(...discoverPluginSkills(codexHomeDir));

    skills.push(...scanSkillRoot('/etc/codex/skills', 'ADMIN'));
    skills.push(...scanSkillRoot(join(codexHomeDir, 'skills', '.system'), 'SYSTEM'));

    return skills.filter(skill => {
        const skillPath = normalizePath(skill.path);
        const skillDir = normalizePath(dirname(skill.path));
        return !disabledSkillPaths.has(skillPath) && !disabledSkillPaths.has(skillDir);
    });
}
