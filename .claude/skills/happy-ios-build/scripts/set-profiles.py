#!/usr/bin/env python3
# Gives each target its own provisioning profile, found by bundle id:
#   set-profiles.py <project.pbxproj> <bundle id>=<profile uuid> ...
# A PROVISIONING_PROFILE_SPECIFIER on the xcodebuild command line would apply to every target,
# so the app's profile would also land on its share extension.
import re, sys

path, pairs = sys.argv[1], dict(arg.split('=', 1) for arg in sys.argv[2:])
src = open(path).read()
done = set()


def patch(m):
    body = m.group(2)
    bundle = re.search(r'PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;', body)
    if not bundle or bundle.group(1) not in pairs:
        return m.group(0)
    done.add(bundle.group(1))
    body = re.sub(r'\n\s*(CODE_SIGN_STYLE|PROVISIONING_PROFILE_SPECIFIER) = [^;]*;', '', body)
    indent = re.search(r'\n(\s*)\S', body).group(1)
    body = (f'\n{indent}CODE_SIGN_STYLE = Manual;'
            f'\n{indent}PROVISIONING_PROFILE_SPECIFIER = "{pairs[bundle.group(1)]}";' + body)
    return m.group(1) + body + m.group(3)


src = re.sub(r'(buildSettings = \{)(.*?)(\n\s*\};)', patch, src, flags=re.S)
missing = set(pairs) - done
if missing:
    sys.exit('no build settings for ' + ', '.join(sorted(missing)))
open(path, 'w').write(src)
