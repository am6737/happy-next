import * as React from 'react';
import { Platform, View } from 'react-native';
import { DARK_DOCUMENT_BACKGROUND } from './staticDocument';

/**
 * The frame paints the document's own reading background, so the gap before the document loads is
 * the color the document will be rather than white.
 */
export function SandboxDocument({
    html,
    scripts = false,
    dark = false,
    title,
    onError,
}: {
    html: string;
    scripts?: boolean;
    dark?: boolean;
    title: string;
    onError: () => void;
}) {
    const frame = React.useRef<HTMLIFrameElement>(null);
    const native = React.useRef<{ injectJavaScript: (script: string) => void }>(null);
    const source = React.useMemo(() => ({ html }), [html]);
    const updateTheme = React.useCallback(() => {
        if (!scripts) return;
        if (Platform.OS === 'web') {
            // The opaque-origin reader receives only a fixed display preference.
            frame.current?.contentWindow?.postMessage({ type: 'preview-theme', dark }, '*');
        } else {
            native.current?.injectJavaScript(`document.documentElement.classList.toggle('preview-dark', ${dark});true;`);
        }
    }, [scripts, dark]);
    React.useEffect(updateTheme, [updateTheme]);
    if (Platform.OS === 'web') {
        return React.createElement('iframe', {
            ref: frame,
            onLoad: updateTheme,
            title,
            srcDoc: html,
            sandbox: scripts ? 'allow-scripts' : '',
            referrerPolicy: 'no-referrer',
            style: {
                width: '100%',
                height: '100%',
                border: 0,
                backgroundColor: dark ? DARK_DOCUMENT_BACKGROUND : '#fff',
                display: 'block',
            },
            onError,
        });
    }
    const WebView = require('react-native-webview').default;
    return (
        <View style={{ flex: 1 }}>
            <WebView
                ref={native}
                source={source}
                onLoadEnd={updateTheme}
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={(request: { url: string }) =>
                    request.url === 'about:blank' ||
                    request.url === 'about:srcdoc'
                }
                javaScriptEnabled={scripts}
                javaScriptCanOpenWindowsAutomatically={false}
                allowFileAccess={false}
                allowFileAccessFromFileURLs={false}
                allowUniversalAccessFromFileURLs={false}
                sharedCookiesEnabled={false}
                thirdPartyCookiesEnabled={false}
                domStorageEnabled={false}
                mixedContentMode="never"
                setSupportMultipleWindows
                onOpenWindow={() => {}}
                onError={onError}
                onContentProcessDidTerminate={onError}
                onRenderProcessGone={onError}
                style={{ flex: 1, backgroundColor: dark ? DARK_DOCUMENT_BACKGROUND : '#fff' }}
            />
        </View>
    );
}
