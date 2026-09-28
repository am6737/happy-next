import * as React from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { consumePreviewHtml } from '@/components/tools/previewHtmlStore';
import { StyleSheet } from 'react-native-unistyles';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';

const WebView = require('react-native-webview').default;

export default React.memo(() => {
    const router = useRouter();
    const { html, title } = React.useMemo(() => consumePreviewHtml(), []);
    // The header is only made transparent so it matches its neighbours through the push
    // transition; the page itself starts below it, as an arbitrary web page has no business
    // scrolling under the header.
    const softHeaderInset = useSoftHeaderInset();

    if (!html) {
        router.back();
        return null;
    }

    return (
        <View style={[styles.container, { paddingTop: softHeaderInset }]}>
            {/* The title the agent gave the page; without one the layout's generic title stays. */}
            {title?.trim() ? <Stack.Screen options={{ headerTitle: title.trim() }} /> : null}
            <WebView
                source={{ html }}
                style={styles.webview}
                originWhitelist={['*']}
                javaScriptEnabled={true}
                scrollEnabled={true}
                // Keeps the page's end clear of the home indicator; the web view defaults to "never".
                contentInsetAdjustmentBehavior="automatic"
            />
        </View>
    );
});

const styles = StyleSheet.create((_theme) => ({
    container: {
        flex: 1,
    },
    webview: {
        flex: 1,
    },
}));
