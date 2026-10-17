/**
 * The Apple Watch app: the active sessions and their status, a session's latest messages, answering
 * permissions and replying (dictation is the watch's own text input). It signs in with the iPhone
 * app's account, which hands it over through WatchConnectivity, and talks to the server itself.
 *
 * HappyKit (encryption and the server's API) is the iPhone module's, linked in.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
    type: 'watch',
    name: 'HappyWatch',
    displayName: 'Happy',
    bundleIdentifier: '.watchkitapp',
    deploymentTarget: '10.0',
    // Relative to the target's folder
    icon: '../../sources/assets/images/icon.png',
    colors: {
        $accent: '#FF9500',
    },
    entitlements: {
        // Shared with the complication: the credentials (as a keychain group) and the last counts
        'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
    },
});
