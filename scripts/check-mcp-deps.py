"""Check installed requirements, including extras, without pip/network/WMI."""
import os
import sys
from importlib.metadata import distribution, PackageNotFoundError
from pathlib import Path
from pip._vendor.packaging import markers
from pip._vendor.packaging.requirements import Requirement

# packaging's default environment calls platform.uname(), which can hang in
# Windows WMI. Only on Windows use OS/Python data already available locally.
if sys.platform == 'win32':
    win = sys.getwindowsversion()
    markers.default_environment = lambda: {
        'implementation_name': sys.implementation.name,
        'implementation_version': '.'.join(map(str, sys.version_info[:3])),
        'os_name': os.name, 'platform_machine': os.environ.get('PROCESSOR_ARCHITECTURE', ''),
        'platform_python_implementation': 'CPython', 'platform_release': str(win.major),
        'platform_system': 'Windows', 'platform_version': f'{win.major}.{win.minor}.{win.build}',
        'python_full_version': '.'.join(map(str, sys.version_info[:3])),
        'python_version': '.'.join(map(str, sys.version_info[:2])), 'sys_platform': sys.platform,
    }

pending = [Requirement(line.strip()) for line in Path(sys.argv[1]).read_text().splitlines()
           if line.strip() and not line.lstrip().startswith('#')]
seen = set()
errors = []
while pending:
    req = pending.pop()
    if req.marker and not req.marker.evaluate({'extra': ''}):
        continue
    try:
        installed = distribution(req.name)
    except PackageNotFoundError:
        errors.append(f'Missing: {req}')
        continue
    if not req.specifier.contains(installed.version, prereleases=True):
        errors.append(f'{req}: installed {installed.version}')
    identity = (installed.metadata['Name'].lower(), tuple(sorted(req.extras)))
    if identity in seen:
        continue
    seen.add(identity)
    for text in installed.requires or []:
        child = Requirement(text)
        if not child.marker or any(child.marker.evaluate({'extra': extra}) for extra in ['', *req.extras]):
            child.marker = None
            pending.append(child)
if errors:
    print('\n'.join(sorted(set(errors))))
    sys.exit(1)
print('MCP dependencies: installed versions and extras OK (offline)')
