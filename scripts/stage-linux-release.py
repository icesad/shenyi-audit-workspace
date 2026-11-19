#!/usr/bin/env python3
"""Prepare a signed team-service release in an operator-controlled Linux directory."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile


RECEIPT = '.shenyi-stage-receipt.json'
REQUIRED_FILES = {
    'package.json', 'package-lock.json', 'scripts/start-team-service.mjs',
    'deploy/linux/shenyi-team.service',
}
PACKAGE_NAME = r'(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*'
PACKAGE_PATH = re.compile(rf'(?:node_modules/{PACKAGE_NAME})(?:/node_modules/{PACKAGE_NAME})*')
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_CACHE_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 8192
PROTECTED_ROOTS = tuple(Path(name) for name in (
    '/etc', '/opt/shenyi-team/current', '/opt/shenyi-team/node', '/opt/shenyi-team/release-tools', '/var/lib/shenyi-team',
))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def existing_path(value, is_dir=False):
    path = Path(value)
    require(path.is_absolute() and path.resolve(strict=True) == path,
            'Use absolute paths without symbolic links or parent traversal.')
    require(path.is_dir() if is_dir else stat.S_ISREG(path.lstat().st_mode),
            'An input has the wrong file type.')
    return path


def release_root(value):
    root = existing_path(value, is_dir=True)
    require(root != Path('/') and 'current' not in root.parts and root.stat().st_uid == os.geteuid()
            and all(not root.is_relative_to(protected) for protected in PROTECTED_ROOTS),
            'Choose an operator-owned release root outside the service, configuration and data directories.')
    for directory in (root, *root.parents):
        info = directory.stat()
        require(info.st_uid in {0, os.geteuid()} and not info.st_mode & 0o022,
                'The release root and its ancestors must be protected from other writers.')
    return root


def copy_regular(source, destination, size_limit):
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as src, destination.open('xb') as dst:
        info = os.fstat(src.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= size_limit,
                'A release input has an unsupported type or exceeds the staging size limit.')
        copied = 0
        for chunk in iter(lambda: src.read(1024 * 1024), b''):
            copied += len(chunk)
            require(copied <= info.st_size, 'A release input grew while being copied.')
            dst.write(chunk)
        require(copied == info.st_size, 'A release input changed size while being copied.')
        return copied


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def extract_release(archive, payload):
    seen = set()
    files = {}
    total_bytes = 0
    with tarfile.open(archive, mode='r:') as bundle:
        for member in bundle:
            name = member.name
            parts = name.split('/')
            total_bytes += member.size
            require(len(seen) < MAX_ENTRIES and 0 <= member.size and total_bytes <= MAX_ARCHIVE_BYTES
                    and len(name.encode('utf-8')) <= 1024,
                    'The verified release exceeds the staging archive limits.')
            require(all(part and part not in {'.', '..'} for part in parts) and '\\' not in name
                    and not any(ord(char) < 32 or ord(char) == 127 for char in name),
                    'The verified release contains an invalid archive path.')
            require(name not in seen and parts[0] not in {'node_modules', '.npmrc', RECEIPT},
                    'The verified release contains a duplicate or reserved archive path.')
            seen.add(name)
            destination = payload.joinpath(*parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            require(member.type in {tarfile.REGTYPE, tarfile.AREGTYPE} and not member.issparse(),
                    'The verified release contains a non-regular archive member.')
            destination.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, destination.open('xb') as output:
                shutil.copyfileobj(source, output)
            destination.chmod(0o644 | (member.mode & 0o111))
            files[name] = digest(destination)
        # Treat unreadable headers or extra payload after the parsed members as an invalid archive.
        bundle.fileobj.seek(bundle.offset)
        require(archive.stat().st_size - bundle.offset >= 1024 and
                all(not any(chunk) for chunk in iter(lambda: bundle.fileobj.read(65536), b'')),
                'The verified Git TAR has an invalid end marker.')
    require(REQUIRED_FILES.issubset(files), 'The verified release is missing required service files.')
    return files


def read_json(path):
    with path.open(encoding='utf-8') as source:
        return json.load(source)


def prepare_cache(source, work):
    cache = work / 'npm-cache'
    cache.mkdir()
    contents = source / '_cacache'
    if os.path.lexists(contents):
        require(stat.S_ISDIR(contents.lstat().st_mode), 'The npm cache must be a real directory.')
        copied = cache / '_cacache'
        entries = 0
        remaining_bytes = MAX_CACHE_BYTES
        for entry in contents.rglob('*'):
            entries += 1
            require(entries <= MAX_ENTRIES, 'The npm cache exceeds the staging entry limit.')
            target = copied / entry.relative_to(contents)
            target.parent.mkdir(parents=True, exist_ok=True)
            if stat.S_ISDIR(entry.lstat().st_mode):
                target.mkdir(exist_ok=True)
            else:
                remaining_bytes -= copy_regular(entry, target, remaining_bytes)
    return cache


def install_packages(node, payload, cache, work, env):
    lock = read_json(payload / 'package-lock.json')
    require(lock.get('lockfileVersion') == 3, 'The signed release requires an npm v3 lockfile.')
    planned = {name: entry for name, entry in lock['packages'].items() if name and not entry.get('dev')}
    require(planned and all(PACKAGE_PATH.fullmatch(name) and not entry.get('link')
            and re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', entry.get('integrity', ''))
            and str(entry.get('resolved', '')).startswith('https://registry.npmjs.org/')
            for name, entry in planned.items()), 'The signed release contains an unpinned production dependency.')

    npm = existing_path(node.parent.parent / 'lib/node_modules/npm/bin/npm-cli.js')
    user_config = work / 'user.npmrc'
    global_config = work / 'global.npmrc'
    user_config.touch()
    global_config.touch()
    installed = subprocess.run([
        node, npm, 'ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund',
        '--userconfig', user_config, '--globalconfig', global_config, '--cache', cache,
    ], cwd=payload, env=env, capture_output=True, timeout=180)
    require(installed.returncode == 0, 'Offline npm installation failed. Check the approved cache against the signed lockfile.')

    acquired = read_json(payload / 'node_modules/.package-lock.json')['packages']
    require(acquired.keys() <= planned.keys() and all(name in acquired or entry.get('optional')
            for name, entry in planned.items()), 'Installed packages differ from the signed lockfile.')
    for name, entry in acquired.items():
        for field in ('version', 'resolved', 'integrity'):
            require(entry.get(field) == planned[name].get(field), 'An installed dependency differs from the signed lockfile.')
        manifest = read_json(payload / name / 'package.json')
        require(manifest.get('version') == entry.get('version'), 'An installed package has an unexpected version.')
    return len(acquired)


def make_read_only(payload):
    for directory, directories, files in os.walk(payload, topdown=False):
        for file in files:
            entry = Path(directory) / file
            mode = entry.lstat().st_mode
            require(stat.S_ISREG(mode), 'The staging directory contains a non-regular file.')
            entry.chmod(0o444 | (mode & 0o111))
        for child in directories:
            require(stat.S_ISDIR((Path(directory) / child).lstat().st_mode),
                    'The staging directory contains a linked directory.')
        Path(directory).chmod(0o555)


def stage(args):
    require(re.fullmatch(r'[0-9a-f]{40}', args.revision), 'Use the full 40-character Git revision.')
    root = release_root(args.release_root)
    published = root / f'staged-{args.revision}'
    node = existing_path(args.node)
    archive = existing_path(args.archive)
    signature = existing_path(args.signature)
    key = existing_path(args.public_key)
    cache = existing_path(args.npm_cache, is_dir=True)
    require(archive.suffix == '.tar' and not key.is_relative_to(archive.parent),
            'Supply a Git TAR and a public key delivered separately from the archive directory.')
    require(not cache.is_relative_to(root) and not root.is_relative_to(cache),
            'Keep the npm cache outside the release tree.')
    env = {'PATH': f'{node.parent}:/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    version = subprocess.check_output([node, '--version'], env=env, text=True, timeout=15).strip()
    match = re.fullmatch(r'v24\.(\d+)\.\d+', version)
    require(match and int(match[1]) >= 15, 'Use Node 24.15 or a newer Node 24 release.')

    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(root_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not os.path.lexists(published), 'This release already has a staged directory.')
        current = root / 'current'
        if os.path.lexists(current):
            active = current.lstat()
            require(stat.S_ISDIR(active.st_mode) and active.st_dev == os.fstat(root_fd).st_dev,
                    'The existing current must be a real directory on the release filesystem.')
        with tempfile.TemporaryDirectory(prefix='.shenyi-preparation-', dir=root) as temporary:
            work = Path(temporary)
            env['HOME'] = str(work)
            # The verifier and extractor both consume these same private bytes.
            private_archive = work / 'release.tar'
            copy_regular(archive, private_archive, MAX_ARCHIVE_BYTES)
            private_archive.chmod(0o400)
            verifier = Path(__file__).resolve().with_name('linux-release-signature.mjs')
            verdict = subprocess.run([
                node, verifier, 'verify', '--archive', private_archive, '--revision', args.revision,
                '--public-key', key, '--signature', signature,
            ], env=env, capture_output=True, text=True, timeout=60)
            require(verdict.returncode == 0, 'The Linux release signature did not verify.')

            payload = work / 'payload'
            payload.mkdir()
            files = extract_release(private_archive, payload)
            production_count = install_packages(node, payload, prepare_cache(cache, work), work, env)
            require(all(digest(payload / name) == sha256 for name, sha256 in files.items()),
                    'A signed release file changed during offline installation.')
            verified = json.loads(verdict.stdout)
            receipt = {
                'ok': True, 'stageDir': str(published), 'archive': verified['archive'],
                'signatureSha256': verified['signatureSha256'], 'publicKeySha256': verified['publicKeySha256'],
                'archiveFiles': len(files), 'productionPackages': production_count,
                'packageLockSha256': files['package-lock.json'], 'offline': True,
            }
            (payload / RECEIPT).write_text(json.dumps(receipt) + '\n', encoding='utf-8')
            make_read_only(payload)
            require(not os.path.lexists(published), 'This release already has a staged directory.')
            payload.rename(published)
            return receipt
    finally:
        os.close(root_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for option in ('node', 'release-root', 'archive', 'revision', 'signature', 'public-key', 'npm-cache'):
        parser.add_argument(f'--{option}', required=True)
    args = parser.parse_args()
    try:
        os.umask(0o022)
        print(json.dumps(stage(args)))
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, subprocess.SubprocessError) as error:
        print(json.dumps({'ok': False, 'message': str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
