#!/usr/bin/env python3
"""Collect local file evidence; do not infer redistribution permission or fetch data."""
import argparse
from collections import Counter
import hashlib
import json
import platform
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def font_names(path):
    """Read sfnt name records only. Keep all platform/language variants, no font edits."""
    data = path.read_bytes()
    if data[:4] not in (b'\x00\x01\x00\x00', b'OTTO', b'true'):
        raise ValueError(f'Unsupported sfnt header: {path.name}')
    count = struct.unpack_from('>H', data, 4)[0]
    for i in range(count):
        tag, _, offset, size = struct.unpack_from('>4sIII', data, 12 + i * 16)
        if tag == b'name':
            table = data[offset:offset + size]
            break
    else:
        raise ValueError('Font has no name table')
    _, count, storage = struct.unpack_from('>HHH', table)
    records = []
    selected = {0, 1, 2, 4, 5, 7, 8, 9, 13, 14}
    for i in range(count):
        platform, encoding, language, name, length, offset = struct.unpack_from('>HHHHHH', table, 6 + i * 12)
        if name not in selected:
            continue
        raw = table[storage + offset:storage + offset + length]
        codec = 'utf-16-be' if platform in (0, 3) else 'mac_roman' if platform == 1 else 'latin-1'
        records.append({'nameId': name, 'platform': platform, 'encoding': encoding,
                        'language': language, 'text': raw.decode(codec, errors='strict')})
    return records


def lock_summary(scope):
    base = ROOT / scope
    lockfile = base / 'package-lock.json'
    package = load(base / 'package.json')
    lock = load(lockfile)
    packages = lock['packages']
    license_counts = Counter()
    missing = []
    for name, entry in sorted(packages.items()):
        if not name:
            continue
        declaration = entry.get('license')
        label = declaration if isinstance(declaration, str) else json.dumps(declaration, sort_keys=True)
        license_counts[label] += 1
        if not declaration:
            missing.append({'path': name, 'version': entry.get('version'),
                            'link': bool(entry.get('link')), 'resolved': entry.get('resolved')})
    direct = []
    for group in ('dependencies', 'devDependencies', 'optionalDependencies'):
        for name, requirement in sorted(package.get(group, {}).items()):
            entry = packages.get('node_modules/' + name, {})
            linked = packages.get(entry.get('resolved'), {}) if entry.get('link') else {}
            direct.append({'group': group, 'name': name, 'requirement': requirement,
                           'version': entry.get('version', linked.get('version')),
                           'declaredLicense': entry.get('license', linked.get('license')),
                           'link': bool(entry.get('link'))})
    return {'scope': scope, 'lockSha256': digest(lockfile),
            'packageCount': len(packages) - 1, 'licenseDeclarationCounts': dict(sorted(license_counts.items())),
            'entriesWithoutLicenseField': missing, 'directDependencies': direct}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='docs/licenses/generated')
    parser.add_argument('--installed', action='store_true', help='Collect selected installed Linux package evidence too')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    # Resolve symlinks before enforcing the repository boundary.
    allowed = ROOT / 'docs/licenses'
    if output in ROOT.parents or (output.is_relative_to(ROOT) and
            (output == allowed or not output.is_relative_to(allowed))):
        raise ValueError('Inside the repository, output must be below docs/licenses/')
    if args.installed and (sys.platform != 'linux' or platform.machine() != 'x86_64'):
        raise ValueError('--installed currently records Linux x64 evidence only')
    git_head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT))
    context = {'gitHead': git_head, 'dirty': dirty,
               'inputBasis': 'tracked set and submodule revisions from index; file bytes from working tree'}
    if dirty:
        print('WARNING: working tree has uncommitted changes; evidence records working-tree bytes.', file=sys.stderr)
    output.mkdir(parents=True, exist_ok=True)
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    selected = []
    for name in tracked:
        if not name or name.startswith('docs/'):
            continue
        path = ROOT / name
        asset = name.startswith(('assets/', 'images/', 'examples/', 'src/renderer/defaultassets/'))
        image = path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.svg', '.ico', '.icns', '.ttf'}
        database = name in {'src/native/db.csv', 'release/app/data/db.csv', 'assets/db.txt'}
        if path.is_file() and (asset or image or database):
            record = {'path': name, 'bytes': path.stat().st_size, 'sha256': digest(path),
                      'kind': 'tag-database' if database else 'font' if path.suffix == '.ttf' else 'example' if name.startswith('examples/') else 'asset',
                      'provenanceStatus': 'not-cleared'}
            if database:
                record['lineCount'] = len(path.read_bytes().splitlines())
            if path.suffix == '.ttf':
                record['fontNames'] = font_names(path)
            selected.append(record)
    root_package = load(ROOT / 'package.json')
    source_paths = ['.erb/scripts/collect-license-evidence.py', 'package.json', 'release/app/package.json', 'src/native/package.json',
                    '.gitmodules', 'src/localai/requirements.txt']
    source_paths += [name for name in ['LICENSES/electron-react-boilerplate.txt', 'CREDITS.md', 'docs/licenses/APP_LICENSE_STATUS.md'] if (ROOT / name).is_file()]
    requirements = (ROOT / 'src/localai/requirements.txt').read_bytes()
    encoding = 'utf-16' if requirements.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8'
    lines = requirements.decode(encoding).splitlines()
    links = subprocess.check_output(['git', 'ls-files', '--stage', '--', 'externals/capacitor-background-mode', 'src/localai/BiRefNet'], cwd=ROOT, text=True).splitlines()
    tracked_report = {'formatVersion': 2, **context, 'purpose': 'evidence inventory, not a redistribution approval',
                      'sourceFiles': [{'path': name, 'sha256': digest(ROOT / name)} for name in source_paths],
                      'submodules': links, 'buildConfiguration': {key: root_package['build'].get(key) for key in ('files', 'extraResources', 'asarUnpack', 'directories')},
                      'locks': [lock_summary(scope) for scope in ('.', 'release/app', 'src/native')],
                      'pythonRequirements': {'encoding': encoding, 'lines': lines, 'licensesVerified': False},
                      'assets': selected}
    write(output / 'tracked-inventory.json', tracked_report)
    if args.installed:
        notices = output / 'notices'
        notices.mkdir(exist_ok=True)
        targets = [
            ('release/app/node_modules/sharp', ['LICENSE', 'vendor/8.14.5/linux-x64/THIRD-PARTY-NOTICES.md', 'vendor/8.14.5/linux-x64/versions.json']),
            ('release/app/node_modules/exiftool-vendored', ['LICENSE']),
            ('release/app/node_modules/exiftool-vendored.pl', ['LICENSE', 'bin/LICENSE', 'bin/README']),
        ]
        img_root = ROOT / 'release/app/node_modules/@img'
        if img_root.is_dir():
            targets += [(str(base.relative_to(ROOT)), ['README.md', 'versions.json'])
                        for base in sorted(img_root.glob('sharp-libvips-*')) if base.is_dir()]
        observations = []
        for relative, files in targets:
            base = ROOT / relative
            if not (base / 'package.json').is_file():
                observations.append({'path': relative, 'available': False})
                continue
            package = load(base / 'package.json')
            locked = load(ROOT / 'release/app/package-lock.json')['packages'].get('node_modules/' + package['name'], {})
            observed = {'lockedVersion': locked.get('version'), 'matchesLock': package['version'] == locked.get('version'), 'path': relative, 'available': True, 'name': package['name'],
                        'version': package['version'], 'declaredLicense': package.get('license'),
                        'packageSha256': digest(base / 'package.json'), 'evidence': []}
            for filename in files:
                source = base / filename
                if not source.is_file():
                    observed['evidence'].append({'path': f'{relative}/{filename}', 'available': False})
                    continue
                name = re.sub(r'[^A-Za-z0-9_.-]', '_', package['name'] + '-' + filename)
                target = notices / name
                shutil.copyfile(source, target)  # Preserve exact bytes, never rewrite copyright or license.
                observed['evidence'].append({'path': f'{relative}/{filename}', 'available': True,
                                             'sha256': digest(source), 'copy': f'notices/{name}'})
            observations.append(observed)
        write(output / 'installed-linux-x64.json', {'formatVersion': 2, **context, 'platform': 'linux-x64',
              'purpose': 'selected installed files only; not all dependency notices or a built artifact manifest',
              'observations': observations, 'notInstalledHere': ['exiftool-vendored.exe (Windows)'],
              'fullBinaryLicenseReviewComplete': False})
    print(f'Evidence collected in {output.relative_to(ROOT) if output.is_relative_to(ROOT) else output}')


if __name__ == '__main__':
    main()
