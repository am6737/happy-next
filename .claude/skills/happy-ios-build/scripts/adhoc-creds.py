#!/usr/bin/env python3
# Lists the targets in the credentials.json that `eas credentials` downloaded, one line each:
#   <bundle id> <profile path> <p12 path> <p12 password>
# With more than one target (the app and its share extension) credentials.json has an entry per
# target name; each is told apart by the bundle id in its profile rather than by that name.
import json, plistlib, subprocess, sys

ios = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'credentials.json'))['ios']
entries = [ios] if 'provisioningProfilePath' in ios else list(ios.values())
for e in entries:
    profile = plistlib.loads(subprocess.run(
        ['security', 'cms', '-D', '-i', e['provisioningProfilePath']],
        capture_output=True, check=True).stdout)
    bundle = profile['Entitlements']['application-identifier'].split('.', 1)[1]
    cert = e['distributionCertificate']
    print(bundle, e['provisioningProfilePath'], cert['path'], cert['password'])
