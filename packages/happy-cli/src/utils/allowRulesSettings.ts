/**
 * "Always allow" rules in a Claude-format settings file (`permissions.allow`). Claude Code reads them
 * from `<project>/.claude/settings.local.json` and qodercli from `<project>/.qoder/settings.local.json`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '@/ui/logger';

/** Adds the rules the file doesn't have yet, creating it if needed. Failures are only logged. */
export async function persistAllowRules(settingsPath: string, rules: string[]): Promise<void> {
    try {
        // A missing or unreadable file starts fresh
        const settings = await readFile(settingsPath, 'utf-8').then((content) => JSON.parse(content), () => ({}));
        settings.permissions = settings.permissions ?? {};
        const allow: string[] = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
        const added = rules.filter((rule) => !allow.includes(rule));
        if (!added.length) return;

        settings.permissions.allow = [...allow, ...added];
        await mkdir(dirname(settingsPath), { recursive: true });
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
        logger.debug(`Persisted allowed tools to ${settingsPath}: ${added.join(', ')}`);
    } catch (error) {
        logger.debug(`Failed to persist allowed tools to ${settingsPath}: ${error}`);
    }
}
