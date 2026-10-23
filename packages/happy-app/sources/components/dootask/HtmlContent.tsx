import * as React from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { StyleSheet } from 'react-native-unistyles';

// --- HTML Content Renderer ---
export type HtmlContentProps = {
    html: string;
    theme: any;
    cacheKey?: string | number;
    selectable?: boolean;
    maxImageWidth?: number;
    onImagePress?: (url: string) => void;
    onImagesFound?: (urls: string[]) => void;
    isSelf?: boolean;
};

const DEFAULT_HEIGHT = 100;
const HEIGHT_PADDING = 16;
const htmlHeightCache = new Map<string, number>();

function getCachedHeight(cacheKey: HtmlContentProps['cacheKey']): number {
    if (cacheKey === undefined || cacheKey === null) return DEFAULT_HEIGHT;
    return htmlHeightCache.get(String(cacheKey)) ?? DEFAULT_HEIGHT;
}

function setCachedHeight(cacheKey: HtmlContentProps['cacheKey'], height: number) {
    if (cacheKey === undefined || cacheKey === null) return;
    htmlHeightCache.set(String(cacheKey), height);
}

export const HtmlContent = React.memo(({ html, theme, cacheKey, selectable, maxImageWidth, onImagePress, onImagesFound, isSelf }: HtmlContentProps) => {
    const [height, setHeight] = React.useState(() => getCachedHeight(cacheKey));
    const containerRef = React.useRef<any>(null);

    React.useEffect(() => {
        setHeight(getCachedHeight(cacheKey));
    }, [cacheKey]);

    // Web: attach click delegation and extract images from DOM
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !containerRef.current) return;
        const el = containerRef.current as HTMLElement;
        // Extract images from actual DOM
        if (onImagesFound) {
            const imgs = el.querySelectorAll('img');
            const urls = Array.from(imgs).map((img: any) => img.src).filter(Boolean);
            if (urls.length > 0) onImagesFound(urls);
        }
        if (!onImagePress) return;
        const handler = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'IMG') {
                e.preventDefault();
                onImagePress((target as HTMLImageElement).src);
            }
        };
        el.addEventListener('click', handler);
        return () => el.removeEventListener('click', handler);
    }, [onImagePress, onImagesFound, html]);

    if (Platform.OS === 'web') {
        return (
            <View style={[styles.htmlContainer, isSelf && styles.selfHtmlContainer]}>
                {/* @ts-ignore - Web only */}
                <style dangerouslySetInnerHTML={{ __html: `
                    .dootask-html-content { color: ${theme.colors.text}; font-size: 14px; line-height: 1.6; word-break: break-word;${selectable ? '' : ' -webkit-user-select: none; user-select: none;'} }
                    .dootask-html-content p { margin: 0.3em 0; }
                    .dootask-html-content img { max-width: ${maxImageWidth ? `${maxImageWidth}px` : '100%'}; height: auto; border-radius: 4px; cursor: pointer; }
                    .dootask-html-content a { color: #0A84FF; }
                    .dootask-html-content pre, .dootask-html-content code { background: ${theme.colors.surfaceHighest || '#2a2a2a'}; border-radius: 4px; padding: 2px 4px; font-size: 13px; }
                    .dootask-html-content pre { padding: 14px; margin: 7px 0; overflow-x: auto; }
                    .dootask-html-content pre code { padding: 0; background: none; }
                    .dootask-html-content blockquote { margin: 1em 0; padding-left: 12px; border-left: 3px solid ${theme.colors.divider || '#333'}; color: ${theme.colors.textSecondary}; }
                    .dootask-html-content ul, .dootask-html-content ol { margin: 1em 0; margin-left: 1.5em; padding-left: 1.5em; }
                    .dootask-html-content li { margin: 0.25em 0; }
                    .dootask-html-content h1 { margin: 0.67em 0; } .dootask-html-content h2 { margin: 0.83em 0; } .dootask-html-content h3 { margin: 1em 0; }
                    .dootask-html-content h4 { margin: 1.33em 0; } .dootask-html-content h5 { margin: 1.67em 0; } .dootask-html-content h6 { margin: 2.33em 0; }
                    .dootask-html-content table { border-collapse: collapse; width: 100%; }
                    .dootask-html-content th, .dootask-html-content td { border: 1px solid ${theme.colors.divider || '#333'}; padding: 6px 8px; text-align: left; }
                    .dootask-html-content .tox-checklist { list-style: none; padding-inline-start: 26px; }
                    .dootask-html-content .tox-checklist li::before { content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='2' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E"); margin-left: -24px; margin-right: 8px; vertical-align: middle; }
                    .dootask-html-content .tox-checklist li.tox-checklist--checked::before { content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='2' fill='%234099ff' stroke='%234099ff' stroke-width='1.5'/%3E%3Cpath d='M4.5 8l2.5 2.5 4.5-5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
                ` }} />
                {/* @ts-ignore - Web only */}
                <div
                    ref={containerRef}
                    className="dootask-html-content"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            </View>
        );
    }

    const wrappedHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
body { margin: 0; padding: 0; color: ${theme.colors.text}; font-size: 14px; line-height: 1.6; background: transparent; font-family: -apple-system, BlinkMacSystemFont, sans-serif; word-break: break-word;${isSelf ? ' text-align: right;' : ''}${selectable ? '' : ' -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;'} }
p { margin: 0.3em 0; }
pre, code, blockquote, ul, ol, table { text-align: left; }
/* The WebView spans the bubble's width: a self message's content hugs the right edge, as on web, but reads left to right. */
.content { display: inline-block; max-width: 100%; text-align: left; vertical-align: top; }
img { max-width: ${maxImageWidth ? `${maxImageWidth}px` : '100%'}; height: auto; border-radius: 4px; cursor: pointer; }
a { color: #0A84FF; }
pre, code { background: ${theme.colors.surfaceHighest || '#2a2a2a'}; border-radius: 4px; padding: 2px 4px; font-size: 13px; }
pre { padding: 14px; margin: 7px 0; overflow-x: auto; }
pre code { padding: 0; background: none; }
blockquote { margin: 1em 0; padding-left: 12px; border-left: 3px solid ${theme.colors.divider || '#333'}; color: ${theme.colors.textSecondary}; }
ul, ol { margin: 1em 0; margin-left: 1.5em; padding-left: 1.5em; }
li { margin: 0.25em 0; }
h1 { margin: 0.67em 0; } h2 { margin: 0.83em 0; } h3 { margin: 1em 0; }
h4 { margin: 1.33em 0; } h5 { margin: 1.67em 0; } h6 { margin: 2.33em 0; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid ${theme.colors.divider || '#333'}; padding: 6px 8px; text-align: left; }
.tox-checklist { list-style: none; padding-inline-start: 26px; }
.tox-checklist li::before { content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='2' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E"); margin-left: -24px; margin-right: 8px; vertical-align: middle; }
.tox-checklist li.tox-checklist--checked::before { content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='2' fill='%234099ff' stroke='%234099ff' stroke-width='1.5'/%3E%3Cpath d='M4.5 8l2.5 2.5 4.5-5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
</style>
</head><body><div class="content">${html}</div>
<script>
function sendHeight() { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', height: document.body.scrollHeight })); }
function sendImages() {
    var imgs = document.querySelectorAll('img');
    var urls = [];
    for (var i = 0; i < imgs.length; i++) { if (imgs[i].src) urls.push(imgs[i].src); }
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'images', urls: urls }));
}
sendHeight();
sendImages();
new MutationObserver(function() { sendHeight(); sendImages(); }).observe(document.body, { childList: true, subtree: true });
window.addEventListener('load', function() { sendHeight(); sendImages(); });
document.addEventListener('click', function(e) {
    var el = e.target;
    if (el.tagName === 'IMG') {
        e.preventDefault();
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'imagePress', url: el.src }));
    }
});
${selectable ? '' : "document.addEventListener('contextmenu', function(e) { e.preventDefault(); });"}
</script>
</body></html>`;

    return (
        <View style={{ height, minHeight: 50, alignSelf: 'stretch' as const }}>
            <WebView
                source={{ html: wrappedHtml }}
                style={{ flex: 1, backgroundColor: 'transparent' }}
                scrollEnabled={false}
                originWhitelist={['*']}
                onMessage={(event) => {
                    try {
                        const data = JSON.parse(event.nativeEvent.data);
                        if (data.type === 'height' && data.height > 0) {
                            const nextHeight = Math.ceil(data.height + HEIGHT_PADDING);
                            setHeight((previousHeight) => {
                                if (Math.abs(previousHeight - nextHeight) <= 2) {
                                    return previousHeight;
                                }
                                setCachedHeight(cacheKey, nextHeight);
                                return nextHeight;
                            });
                        } else if (data.type === 'imagePress' && data.url && onImagePress) {
                            onImagePress(data.url);
                        } else if (data.type === 'images' && data.urls && onImagesFound) {
                            onImagesFound(data.urls);
                        }
                    } catch { }
                }}
            />
        </View>
    );
});

const styles = StyleSheet.create((_theme) => ({
    htmlContainer: { minHeight: 20, alignSelf: 'stretch' as const },
    selfHtmlContainer: { alignItems: 'flex-end' as const },
}));
