import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';

const state = vi.hoisted(() => ({
    params: {} as { textId: string; from?: string; format?: string; language?: string },
    text: '',
    retrieve: vi.fn(),
    copy: vi.fn(async (_text: string) => {}),
    router: { back: vi.fn() },
}));

vi.mock('react-native', () => ({
    View: 'View', Text: 'Text', Pressable: 'Pressable', Platform: { OS: 'web' },
    useWindowDimensions: () => ({ width: 390 }),
}));
vi.mock('expo-router', () => ({
    useRouter: () => state.router,
    useLocalSearchParams: () => state.params,
    Stack: { Screen: 'StackScreen' },
}));
vi.mock('react-native-unistyles', () => {
    const theme = { colors: { surface: '#fff', text: '#000', textSecondary: '#666', header: { tint: '#000' } } };
    return {
        useUnistyles: () => ({ theme, rt: { themeName: 'light' } }),
        StyleSheet: { create: (styles: (theme: unknown) => unknown) => styles(theme) },
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@/sync/persistence', () => ({ retrieveTempText: state.retrieve }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({
    t: (key: string) => ({
        'textSelection.formatPlainText': '纯文本',
    }[key] ?? key),
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: state.copy }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/components/haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('@/components/Toast', () => ({ showCopiedToast: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('@/components/SelectableTextView', () => ({ SelectableTextView: 'SelectableTextView' }));
vi.mock('@/components/FilePreview/SandboxDocument', () => ({ SandboxDocument: 'SandboxDocument' }));
vi.mock('@/components/NativeMenu', () => ({ NativeMenu: 'NativeMenu' }));
vi.mock('@/components/ActionMenuModal', () => ({ ActionMenuModal: 'ActionMenuModal' }));
vi.mock('@/components/FilePreview/FileViewTabs', () => ({
    FileViewTabs: (props: { trailing: React.ReactNode }) => React.createElement('FileViewTabs', props, props.trailing),
}));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/components/navigation/softHeader', () => ({ useSoftHeaderInset: () => 0 }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));

import TextSelectionScreen from '@/app/(app)/text-selection';

let renderer: ReturnType<typeof create> | undefined;
const html = '<!DOCTYPE html><html><body><h1>Hello</h1><script>const value = 1;</script></body></html>\r\n';

function render(text: string, params: Partial<typeof state.params> = {}) {
    state.text = text;
    state.params = { textId: 'text-1', ...params };
    act(() => { renderer = create(React.createElement(TextSelectionScreen)); });
    return renderer!;
}

function chooseFormat(label: string) {
    const menu = renderer!.root.findByType('NativeMenu');
    const item = menu.props.items.find((entry: { label: string }) => entry.label === label);
    expect(item).toBeDefined();
    act(() => { item.onPress(); });
}

function chooseTab(tab: 'source' | 'preview') {
    act(() => { renderer!.root.findByType('FileViewTabs').props.onChange(tab); });
}

function formatLabel() {
    return renderer!.root.findByType('NativeMenu').findByType('Text').props.children;
}

function selectedFormatLabels() {
    return renderer!.root.findByType('NativeMenu').props.items
        .filter((item: { selected: boolean }) => item.selected)
        .map((item: { label: string }) => item.label);
}

beforeEach(() => {
    vi.clearAllMocks();
    state.retrieve.mockImplementation(() => state.text);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => { renderer?.unmount(); });
    renderer = undefined;
});

describe('text selection format controls', () => {
    it('keeps chat messages in Markdown and switches both tabs to the chosen format', () => {
        const screen = render(html, { format: 'markdown', from: 'too-long' });
        expect(screen.root.findByType('SandboxDocument').props.html).toContain('&lt;!DOCTYPE html&gt;');
        expect(screen.root.findByType('SandboxDocument').props.scripts).toBe(false);
        expect(formatLabel()).toBe('Markdown');
        expect(screen.root.findByType('NativeMenu').props.items.map((item: { label: string }) => item.label)).toEqual(['Markdown', 'HTML', 'JSON', '纯文本']);
        expect(screen.root.findByType('NativeMenu').props.items[0].selected).toBe(true);

        chooseFormat('HTML');
        expect(screen.root.findByType('SandboxDocument').props.html).toBe(html);
        expect(screen.root.findByType('SandboxDocument').props.scripts).toBe(true);
        expect(formatLabel()).toBe('HTML');
        expect(screen.root.findByType('NativeMenu').props.items[1].selected).toBe(true);

        chooseTab('source');
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('html');
        expect(screen.root.findByType('SelectableTextView').props.text).toBe(html);

        chooseFormat('纯文本');
        chooseTab('preview');
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('plaintext');
        expect(screen.root.findAllByType('SandboxDocument')).toHaveLength(0);
        expect(formatLabel()).toBe('纯文本');

        chooseFormat('Markdown');
        expect(screen.root.findByType('SandboxDocument').props.scripts).toBe(false);
        expect(state.retrieve).toHaveBeenCalledTimes(1);
    });

    it('detects standalone HTML when the source has no format', () => {
        const screen = render(html);
        expect(formatLabel()).toBe('HTML');
        expect(screen.root.findByType('NativeMenu').props.items[1].selected).toBe(true);
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('html');
        chooseTab('preview');
        expect(screen.root.findByType('SandboxDocument').props.html).toBe(html);
    });

    it('uses known code languages in both tabs and allows an unhighlighted plain-text override', () => {
        const screen = render('{"name":"hello"}', { language: 'json' });
        expect(formatLabel()).toBe('JSON');
        expect(selectedFormatLabels()).toEqual(['JSON']);
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('json');
        chooseTab('preview');
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('json');
        chooseFormat('纯文本');
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('plaintext');
        expect(formatLabel()).toBe('纯文本');
        expect(selectedFormatLabels()).toEqual(['纯文本']);

        chooseFormat('JSON');
        expect(formatLabel()).toBe('JSON');
        expect(selectedFormatLabels()).toEqual(['JSON']);
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('json');
    });

    it.each([
        ['css', 'CSS'],
        ['ts', 'TypeScript'],
        ['python', 'Python'],
    ])('keeps the displayed and selected %s format consistent after overrides', (language, label) => {
        const screen = render('example code', { language });
        expect(formatLabel()).toBe(label);
        expect(selectedFormatLabels()).toEqual([label]);

        chooseFormat('HTML');
        expect(formatLabel()).toBe('HTML');
        expect(selectedFormatLabels()).toEqual(['HTML']);

        chooseFormat(label);
        expect(formatLabel()).toBe(label);
        expect(selectedFormatLabels()).toEqual([label]);
        expect(screen.root.findByType('SelectableTextView').props.language).toBe(language === 'ts' ? 'typescript' : language);
    });

    it('automatically identifies a new document after a manual override', () => {
        const screen = render('# Hello', { format: 'markdown' });
        chooseFormat('纯文本');
        expect(formatLabel()).toBe('纯文本');

        state.text = html;
        state.params = { textId: 'text-2', language: 'html' };
        act(() => { screen.update(React.createElement(TextSelectionScreen)); });
        expect(formatLabel()).toBe('HTML');
        expect(screen.root.findByType('SelectableTextView').props.language).toBe('html');
    });

    it('copies the original source after changing formats', async () => {
        const screen = render(html, { format: 'markdown' });
        chooseFormat('HTML');
        const copyButton = screen.root.findByType('StackScreen').props.options.headerRight();
        await act(async () => { await copyButton.props.onPress(); });
        expect(state.copy).toHaveBeenCalledWith(html);
    });

    it('can retry a failed preview and clear the failure by changing format', () => {
        const screen = render('# Hello', { format: 'markdown', from: 'too-long' });
        act(() => { screen.root.findByType('SandboxDocument').props.onError(); });
        expect(screen.root.findAllByType('SandboxDocument')).toHaveLength(0);
        const retry = screen.root.findAllByType('Pressable').find((node: { props: { onPress?: unknown } }) => node.props.onPress);
        act(() => { retry.props.onPress(); });
        expect(screen.root.findAllByType('SandboxDocument')).toHaveLength(1);

        act(() => { screen.root.findByType('SandboxDocument').props.onError(); });
        chooseFormat('HTML');
        expect(screen.root.findByType('SandboxDocument').props.scripts).toBe(true);
    });
});
