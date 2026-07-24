import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseMarkdownFrontmatter, readYamlString } from '@/utils/yaml';

export type ClaudeSlashCommandKind = 'command' | 'skill';
export type ClaudeSlashCommandScope = 'REPO' | 'USER' | 'PLUGIN' | 'SYSTEM';

export interface ClaudePluginMetadata {
    name: string;
    path?: string;
    source?: string;
}

export interface ClaudeSlashCommandMetadata {
    name: string;
    description?: string;
    kind: ClaudeSlashCommandKind;
    scope: ClaudeSlashCommandScope;
}

export interface ClaudeInitCapabilities {
    slashCommands?: string[];
    skills?: string[];
    plugins?: ClaudePluginMetadata[];
    cwd?: string;
}

function normalizeCommandName(name: string): string {
    return name.trim().replace(/^\/+/, '');
}

function normalizePath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return resolve(path);
    }
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

function readFrontmatter(filePath: string): Record<string, unknown> | null {
    try {
        return parseMarkdownFrontmatter(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function addAlias(
    map: Map<string, ClaudeSlashCommandMetadata>,
    aliases: string[],
    metadata: Omit<ClaudeSlashCommandMetadata, 'name'>,
): void {
    for (const alias of aliases) {
        const name = normalizeCommandName(alias);
        if (!name || map.has(name)) continue;
        map.set(name, { name, ...metadata });
    }
}

function scanSkillRoot(
    root: string,
    scope: ClaudeSlashCommandScope,
    map: Map<string, ClaudeSlashCommandMetadata>,
    pluginName?: string,
): void {
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const skillDir = join(root, entry.name);
            const skillPath = join(skillDir, 'SKILL.md');
            const frontmatter = readFrontmatter(skillPath);
            if (!frontmatter && !existsSync(skillPath)) continue;

            const skillName = readYamlString(frontmatter?.name) || entry.name;
            const description = readYamlString(frontmatter?.description, true);
            const aliases = [skillName];
            if (pluginName) aliases.push(`${pluginName}:${skillName}`);

            addAlias(map, aliases, {
                kind: 'skill',
                scope,
                ...(description ? { description } : {}),
            });
        }
    } catch {
        // Root does not exist or is not readable.
    }
}

function scanCommandRoot(
    root: string,
    scope: ClaudeSlashCommandScope,
    map: Map<string, ClaudeSlashCommandMetadata>,
    pluginName?: string,
): void {
    function visit(dir: string): void {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

            const rel = relative(root, fullPath).replace(/\\/g, '/').replace(/\.md$/, '');
            const commandName = rel.split('/').join(':');
            const baseName = basename(entry.name, '.md');
            const aliases = commandName === baseName ? [commandName] : [commandName, baseName];
            if (pluginName) {
                aliases.push(...aliases.map(alias => `${pluginName}:${alias}`));
            }
            const frontmatter = readFrontmatter(fullPath);
            const description = readYamlString(frontmatter?.description, true);
            addAlias(map, aliases, {
                kind: 'command',
                scope,
                ...(description ? { description } : {}),
            });
        }
    }

    visit(root);
}

function getPluginName(plugin: ClaudePluginMetadata): string | undefined {
    const explicit = plugin.name?.trim();
    if (explicit) return explicit;
    const sourceName = plugin.source?.split('@')[0]?.trim();
    return sourceName || undefined;
}

function buildKnownCommandMetadata(
    capabilities: ClaudeInitCapabilities,
    cwd: string,
    homeDir: string,
): Map<string, ClaudeSlashCommandMetadata> {
    const map = new Map<string, ClaudeSlashCommandMetadata>();
    const repoRoot = findGitRoot(cwd);

    for (const ancestor of collectAncestors(cwd, repoRoot)) {
        scanSkillRoot(join(ancestor, '.claude', 'skills'), 'REPO', map);
        scanCommandRoot(join(ancestor, '.claude', 'commands'), 'REPO', map);
    }

    scanSkillRoot(join(homeDir, '.claude', 'skills'), 'USER', map);
    scanCommandRoot(join(homeDir, '.claude', 'commands'), 'USER', map);

    for (const plugin of capabilities.plugins ?? []) {
        if (!plugin.path) continue;
        const pluginRoot = normalizePath(plugin.path);
        const pluginName = getPluginName(plugin);
        scanSkillRoot(join(pluginRoot, 'skills'), 'PLUGIN', map, pluginName);
        scanSkillRoot(join(pluginRoot, '.claude', 'skills'), 'PLUGIN', map, pluginName);
        scanCommandRoot(join(pluginRoot, 'commands'), 'PLUGIN', map, pluginName);
        scanCommandRoot(join(pluginRoot, '.claude', 'commands'), 'PLUGIN', map, pluginName);
    }

    return map;
}

export function buildClaudeSlashCommandMetadata(
    capabilities: ClaudeInitCapabilities,
    opts: { cwd?: string; homeDir?: string } = {},
): ClaudeSlashCommandMetadata[] | undefined {
    if (!capabilities.slashCommands || capabilities.slashCommands.length === 0) {
        return undefined;
    }

    const cwd = opts.cwd || capabilities.cwd || process.cwd();
    const homeDir = opts.homeDir || os.homedir();
    const knownMetadata = buildKnownCommandMetadata(capabilities, cwd, homeDir);
    const skillCommands = new Set((capabilities.skills ?? []).map(normalizeCommandName));

    return capabilities.slashCommands.map((rawName) => {
        const name = normalizeCommandName(rawName);
        const known = knownMetadata.get(name);
        if (known) {
            return { ...known, name };
        }
        if (skillCommands.has(name)) {
            return { name, kind: 'skill', scope: 'SYSTEM' };
        }
        return { name, kind: 'command', scope: 'SYSTEM' };
    });
}
