const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'Raise pods below the minimum iOS deployment target';
const MINIMUM_TARGET = '15.1';

// Xcode 27 rejects a deployment target below iOS 15.0 as an error, and some pods (SDWebImage,
// lottie, RNSVG...) still declare 9.0-13.4. Raise those to the app's own target.
const RUBY_PATCH = `
    # ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || Gem::Version.new(current) < Gem::Version.new('${MINIMUM_TARGET}')
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MINIMUM_TARGET}'
        end
      end
    end
`;

function withMinimumPodDeploymentTarget(config) {
    return withDangerousMod(config, ['ios', (config) => {
        const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
        if (!fs.existsSync(podfilePath)) {
            return config;
        }

        let contents = fs.readFileSync(podfilePath, 'utf8');
        if (contents.includes(MARKER)) {
            return config;
        }

        const postInstallCall = /(\n\s+react_native_post_install\([\s\S]*?\n\s+\)\n)/m;
        if (!postInstallCall.test(contents)) {
            throw new Error('Could not find react_native_post_install in ios/Podfile');
        }

        contents = contents.replace(postInstallCall, `$1${RUBY_PATCH}`);
        fs.writeFileSync(podfilePath, contents);

        return config;
    }]);
}

module.exports = withMinimumPodDeploymentTarget;
