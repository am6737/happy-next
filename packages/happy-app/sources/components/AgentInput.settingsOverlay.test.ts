import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('AgentInput settings overlay alignment', () => {
    test('uses the panel inset instead of screen width for model and permission overlays', () => {
        const source = readFileSync(join(__dirname, 'AgentInput.tsx'), 'utf8');

        expect(source).toContain('const panelHorizontalInset = props.panelSideMargin ? 8 : 0;');
        expect(source).toMatch(/styles\.settingsOverlay,\s*\{ paddingHorizontal: panelHorizontalInset \}/);
        expect(source).toMatch(/styles\.unifiedPanel,[^\n]*\{ marginHorizontal: panelHorizontalInset \}/);
    });
});
