import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('MainView native tab icons', () => {
    test('uses a navigation asset for the GitHub native bottom tab icon', () => {
        const source = readFileSync(join(__dirname, 'MainView.tsx'), 'utf8');

        expect(source).toContain("focusedIcon: require('@/assets/images/navigation/github.png')");
        expect(existsSync(join(__dirname, '../assets/images/navigation/github.png'))).toBe(true);
    });

    test('reinitializes native tab indices when integration tabs are inserted or removed', () => {
        const source = readFileSync(join(__dirname, 'MainView.tsx'), 'utf8');
        expect(source).toContain("key={nativeTabRoutes.map((route) => route.key).join(':')}");
        expect(source).toContain('nativeTabRoutes.findIndex(r => r.key === activeTab)');
        expect(source).toContain('navigationState={{ index: nativeActiveIndex, routes: nativeTabRoutes }}');
        expect(source).not.toContain('<TabView key={activeTab}');
    });
});
