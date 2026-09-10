import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('GitHub desktop and web navigation', () => {
    test.each(['components/SidebarView.tsx', 'desktop/DesktopWindowFrame.tsx'])(
        '%s exposes the connected GitHub integration',
        (file) => {
            const source = readFileSync(join(__dirname, '..', file), 'utf8');
            expect(source).toContain('const profile = useProfile()');
            expect(source).toContain('{!!profile.github && (');
            expect(source).toContain("accessibilityLabel={t('tabs.github')}");
            expect(source).toContain("router.navigate('/(app)/github')");
            expect(source).toContain("require('@/assets/images/navigation/github.png')");
        },
    );

    test('registers a standalone list route with repository selection', () => {
        const layout = readFileSync(join(__dirname, '../app/(app)/_layout.tsx'), 'utf8');
        const page = readFileSync(join(__dirname, '../app/(app)/github/index.tsx'), 'utf8');
        expect(layout).toContain('name="github/index"');
        expect(page).toContain('<GitHubListView onRepoChange={setRepo} repoPickerTriggerRef={repoPickerTriggerRef} />');
        expect(page).toContain('repoPickerTriggerRef.current?.()');
        expect(existsSync(join(__dirname, '../assets/images/navigation/github.png'))).toBe(true);
    });
});
