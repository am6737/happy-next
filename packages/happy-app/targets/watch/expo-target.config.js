/**
 * The Apple Watch app: the active sessions and their status, a session's latest messages, answering
 * permissions and replying (dictation is the watch's own text input). It signs in with the iPhone
 * app's account, which hands it over through WatchConnectivity, and talks to the server itself.
 *
 * HappyKit (encryption and the server's API) is the iPhone module's, linked in.
 */

// The app's session avatars (AvatarBrutalist), in its order: a session picks one by the hash of its id
const AVATARS = '../../sources/assets/images/brutalist';
const avatarFiles = [
    ...Array.from({ length: 262 }, (_, i) => `Abstract ${i + 1}`),
    ...Array.from({ length: 40 }, (_, i) => `Bauhaus ${i + 1}`),
    ...Array.from({ length: 118 }, (_, i) => `Brutalism ${i + 1}`),
    'Specified 1',
    'Specified 2',
];

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
    type: 'watch',
    name: 'HappyWatch',
    displayName: config.name,
    bundleIdentifier: '.watchkitapp',
    deploymentTarget: '10.0',
    // Relative to the target's folder
    icon: '../../sources/assets/images/icon.png',
    colors: {
        $accent: '#FF9500',
    },
    // Relative to the target's folder
    images: {
        ...Object.fromEntries(avatarFiles.map((file, i) => [`avatar-${i}`, `${AVATARS}/${file}.png`])),
        'session-dootask': '../../sources/assets/images/icon-dootask.png',
        'session-github': '../../sources/assets/images/icon-github-session.png',
    },
    entitlements: {
        // Shared with the complication: the credentials (as a keychain group) and the last counts
        'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
    },
});
