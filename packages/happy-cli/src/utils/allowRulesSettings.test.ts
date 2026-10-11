import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

import { persistAllowRules } from './allowRulesSettings';

describe('persistAllowRules', () => {
    it('creates the file', async () => {
        const path = join(await mkdtemp(join(tmpdir(), 'allow-rules-')), '.qoder', 'settings.local.json');
        await persistAllowRules(path, ['Bash(git:*)']);
        expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual({ permissions: { allow: ['Bash(git:*)'] } });
    });

    it('adds only new rules and keeps the rest of the settings', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'allow-rules-'));
        const path = join(dir, '.claude', 'settings.local.json');
        await mkdir(join(dir, '.claude'));
        await writeFile(path, JSON.stringify({ model: 'x', permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] } }));
        await persistAllowRules(path, ['Read', 'Bash(cd:*)']);
        expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual({ model: 'x', permissions: { allow: ['Read', 'Bash(cd:*)'], deny: ['Bash(rm:*)'] } });
    });
});
