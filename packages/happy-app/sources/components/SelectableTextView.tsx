import * as React from 'react';
import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { useUnistyles } from 'react-native-unistyles';
import { highlightMarkdownToHtml } from '@/utils/highlightMarkdownToHtml';
import { MONO_FONT_STACK } from '@/components/codeEditorShared';

/**
 * Selectable, syntax-highlighted text rendering shared by the text-selection
 * screen and inline surfaces (e.g. the pending-message detail modal).
 *
 * Renders markdown-highlighted content inside a WebView (native) / iframe (web)
 * so the text is natively selectable and scrolls internally. The host controls
 * the size — give this a bounded-height container; it fills it.
 */

interface TokenRule {
    selector: string;
    color?: { light: string; dark: string };
    extra?: string;
}

const TOKEN_RULES: TokenRule[] = [
    { selector: '.tok-keyword, .tok-macroName, .tok-labelName', color: { light: '#af00db', dark: '#c586c0' } },
    { selector: '.tok-comment', color: { light: '#008000', dark: '#6a9955' }, extra: 'font-style: italic;' },
    { selector: '.tok-string, .tok-string2, .tok-attributeValue', color: { light: '#a31515', dark: '#ce9178' } },
    { selector: '.tok-number', color: { light: '#098658', dark: '#b5cea8' } },
    { selector: '.tok-bool, .tok-atom, .tok-literal', color: { light: '#0000ff', dark: '#569cd6' } },
    { selector: '.tok-meta, .tok-namespace, .tok-variableName, .tok-propertyName, .tok-attributeName', color: { light: '#001080', dark: '#9cdcfe' } },
    { selector: '.tok-operator, .tok-punctuation', color: { light: '#1f2328', dark: '#d4d4d4' } },
    { selector: '.tok-link, .tok-url', color: { light: '#0366d6', dark: '#569cd6' }, extra: 'text-decoration: underline;' },
    { selector: '.tok-heading', color: { light: '#800000', dark: '#4ec9b0' }, extra: 'font-weight: bold;' },
    { selector: '.tok-typeName, .tok-className', color: { light: '#267f99', dark: '#4ec9b0' } },
    { selector: '.tok-inserted', color: { light: '#098658', dark: '#4ec9b0' } },
    { selector: '.tok-deleted', color: { light: '#b31d28', dark: '#f48771' } },
    { selector: '.tok-invalid', color: { light: '#b31d28', dark: '#f48771' }, extra: 'text-decoration: underline;' },
    { selector: '.tok-tagName', color: { light: '#800000', dark: '#569cd6' } },
    { selector: '.tok-emphasis', extra: 'font-style: italic;' },
    { selector: '.tok-strong', extra: 'font-weight: bold;' },
    { selector: '.tok-monospace', extra: `font-family: ${MONO_FONT_STACK};` },
];

function highlightCss(isDark: boolean): string {
    return TOKEN_RULES.map(r => {
        const decls: string[] = [];
        if (r.color) decls.push(`color: ${isDark ? r.color.dark : r.color.light};`);
        if (r.extra) decls.push(r.extra);
        return `${r.selector} { ${decls.join(' ')} }`;
    }).join('\n');
}

export function buildSelectionHtml(args: {
    highlightedHtml: string;
    isDark: boolean;
    backgroundColor: string;
    textColor: string;
    bottomPadding: number;
}): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: ${args.backgroundColor};
    color: ${args.textColor};
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }
  body {
    padding: 16px 16px ${args.bottomPadding}px 16px;
    box-sizing: border-box;
    overflow-x: hidden;
  }
  #content {
    font-family: ${MONO_FONT_STACK};
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
    cursor: text;
  }
  ${highlightCss(args.isDark)}
</style>
</head>
<body>
<div id="content">${args.highlightedHtml}</div>
</body>
</html>`;
}

export function SelectableTextView({ text, bottomPadding = 16 }: { text: string; bottomPadding?: number }) {
    const { theme, rt } = useUnistyles();
    const isDark = rt.themeName === 'dark';

    const html = React.useMemo(() => {
        const highlighted = text ? highlightMarkdownToHtml(text) : '';
        return buildSelectionHtml({
            highlightedHtml: highlighted,
            isDark,
            backgroundColor: theme.colors.surface,
            textColor: theme.colors.text,
            bottomPadding,
        });
    }, [text, isDark, theme.colors.surface, theme.colors.text, bottomPadding]);

    if (Platform.OS === 'web') {
        // react-native-webview is unsupported on web. Use a plain iframe with the same
        // srcDoc html — same content & styling as the native side.
        return (
            // @ts-ignore web-only iframe
            <iframe
                title="selectable-text"
                srcDoc={html}
                sandbox="allow-same-origin"
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    background: 'transparent',
                    flex: 1,
                }}
            />
        );
    }

    return (
        <WebView
            originWhitelist={['*']}
            source={{ html }}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            mixedContentMode="always"
            {...(Platform.OS === 'ios' ? {
                contentInsetAdjustmentBehavior: 'never' as const,
                automaticallyAdjustContentInsets: false,
                decelerationRate: 'normal' as const,
                directionalLockEnabled: true,
            } : {})}
            style={{ flex: 1, backgroundColor: 'transparent' }}
        />
    );
}
