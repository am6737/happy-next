/** @type {import('expo/fingerprint').Config} */
const { SourceSkips } = require('expo/fingerprint');

// The runtime version is this fingerprint (app.config.js), so it must come out the same on the
// machine that builds the app and the one that publishes an OTA update (`yarn ota publish`).
module.exports = {
    // The version and the `extra` section are read by JS only and differ with the build's env
    sourceSkips:
        SourceSkips.ExpoConfigVersions |
        SourceSkips.ExpoConfigExtraSection |
        SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
    // DooPush's Android vendors come partly from EAS secret files (HMS, Honor), which an EAS
    // build has and `eas env:pull` can't fetch, and as paths that differ per machine. Left out,
    // so changing push vendors needs a new build that the fingerprint doesn't ask for.
    fileHookTransform: (source, chunk) => {
        if (source.type !== 'contents' || source.id !== 'expoConfig' || typeof chunk !== 'string') {
            return chunk;
        }
        const config = JSON.parse(chunk);
        for (const plugin of config.plugins ?? []) {
            if (Array.isArray(plugin) && plugin[0] === 'doopush-react-native-sdk' && plugin[1]?.android) {
                delete plugin[1].android.vendors;
            }
        }
        return JSON.stringify(config);
    },
};
