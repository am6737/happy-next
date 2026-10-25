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
    // Added to Expo's defaults: files in node_modules that depend on what the machine has done,
    // not on what is installed
    ignorePaths: [
        // macOS metadata that some packages ship (react-native-libsodium has ~1800); tar on macOS
        // turns them into xattrs, elsewhere they stay files
        '**/._*',
        // Prebuilt ffmpeg that react-native-audio-api downloads at pod install / gradle time
        '**/node_modules/react-native-audio-api/common/cpp/audioapi/external/{android,ffmpeg_ios,iphoneos,iphonesimulator,macosx}/**',
        '**/node_modules/react-native-audio-api/android/src/main/jniLibs/**',
        // React Native's gradle plugin strips the `package` attribute from libraries' manifests in
        // place on every Android build
        '**/node_modules/**/android/src/main/AndroidManifest.xml',
        // The Mac mini's build script appends a temporary profile to it to download credentials
        'eas.json',
    ],
    fileHookTransform: (source, chunk) => {
        if (source.type !== 'contents' || source.id !== 'expoConfig' || typeof chunk !== 'string') {
            return chunk;
        }
        const config = JSON.parse(chunk);
        for (const plugin of config.plugins ?? []) {
            // DooPush's Android vendors come partly from EAS secret files (HMS, Honor), which an
            // EAS build has and `eas env:pull` can't fetch, and as paths that differ per machine.
            // Left out, so changing push vendors needs a new build that the fingerprint doesn't ask for.
            if (Array.isArray(plugin) && plugin[0] === 'doopush-react-native-sdk' && plugin[1]?.android) {
                delete plugin[1].android.vendors;
            }
            // ABI_FILTERS comes from the eas.json profile, which neither the Mac mini's build nor
            // `yarn ota publish` reads; which ABIs are built doesn't change what JS they can run
            if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties' && plugin[1]?.android) {
                delete plugin[1].android.buildArchs;
            }
        }
        return JSON.stringify(config);
    },
};
