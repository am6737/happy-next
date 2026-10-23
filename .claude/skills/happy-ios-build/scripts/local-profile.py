#!/usr/bin/env python3
# Finds the Ad Hoc profile for a bundle id among the ones the user made on the Apple Developer
# portal and put in a folder (EAS can't put an Apple Watch in its profiles, so the watch targets'
# come from there). The folder is in iCloud Drive, so files only in the cloud are downloaded first:
#   local-profile.py <folder> <bundle id> <p12> <p12 password>
# Prints the path of the newest unexpired one that signs with the p12's certificate; exits 1 when
# there is none.
import datetime, glob, os, plistlib, subprocess, sys, time

folder, bundle, p12, password = sys.argv[1:5]


def p12_cert_der():
    for legacy in (['-legacy'], []):
        pem = subprocess.run(['openssl', 'pkcs12', '-in', p12, '-passin', 'pass:' + password, '-nokeys', '-clcerts', *legacy],
                             capture_output=True).stdout
        if b'BEGIN CERTIFICATE' in pem:
            return subprocess.run(['openssl', 'x509', '-outform', 'der'], input=pem, capture_output=True, check=True).stdout
    sys.exit('could not read the certificate in ' + p12)


def download(folder):
    # With Optimize Mac Storage a file can be only in the cloud. On the Mac mini's macOS (26) it keeps
    # its name and downloads when read; older macOS leave a .<name>.icloud placeholder instead, which
    # brctl fetches, and the real file then appears
    waiting = []
    for path in glob.glob(os.path.join(folder, '.*.mobileprovision.icloud')):
        real = os.path.join(folder, os.path.basename(path)[1:-len('.icloud')])
        subprocess.run(['brctl', 'download', path], capture_output=True)
        waiting.append(real)
    deadline = time.time() + 120
    while any(not os.path.exists(path) for path in waiting):
        if time.time() > deadline:
            sys.exit('iCloud did not download ' + ', '.join(p for p in waiting if not os.path.exists(p)))
        time.sleep(2)


if not os.path.isdir(folder):
    sys.exit('no folder ' + folder)
download(folder)
cert = p12_cert_der()
now = datetime.datetime.now(datetime.timezone.utc)
best = None
for path in glob.glob(os.path.join(folder, '*.mobileprovision')):
    out = subprocess.run(['security', 'cms', '-D', '-i', path], capture_output=True).stdout
    if not out:
        continue
    profile = plistlib.loads(out)
    expires = profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc)
    if profile['Entitlements']['application-identifier'].split('.', 1)[1] != bundle or expires <= now:
        continue
    # Ad Hoc: a distribution certificate (no get-task-allow) and a device list
    if cert not in profile.get('DeveloperCertificates', []) or profile['Entitlements'].get('get-task-allow') \
            or not profile.get('ProvisionedDevices'):
        continue
    if best is None or expires > best[0]:
        best = (expires, path)
if best is None:
    sys.exit(1)
print(best[1])
