/**
 * The watch face complication: how many sessions wait for a permission and how many are working.
 * It reads the server with the credentials the watch app keeps in their shared group, and falls back
 * to the counts the watch app saw last.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
    type: 'watch-widget',
    name: 'HappyWatchWidget',
    displayName: config.name,
    bundleIdentifier: '.watchkitapp.widget',
    deploymentTarget: '10.0',
    colors: {
        $accent: '#FF9500',
        $widgetBackground: '#000000',
    },
    entitlements: {
        'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
    },
});
