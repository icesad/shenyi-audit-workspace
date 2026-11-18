#!/usr/bin/env python3
"""Repackage the pinned Electron ZIP without extracting its macOS symlinks."""

import argparse
from collections import deque
from copy import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
from shutil import copyfileobj
import stat
import struct
import sys
import unicodedata
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED, ZIP_STORED


SOURCE_APP = 'Electron.app'
APP = 'Shenyi.app'
BUNDLE_ID = 'invalid.shenyi.audit.candidate'
RESOURCES = ('Contents', 'Resources')
DEFAULT_APP = (SOURCE_APP, *RESOURCES, 'default_app.asar')
PAYLOAD = (APP, *RESOURCES, 'app')
HELPERS = (SOURCE_APP, 'Contents', 'Frameworks')
LOGIN_ITEMS = (SOURCE_APP, 'Contents', 'Library', 'LoginItems')
REQUIRED_HELPERS = {'Electron Helper', 'Electron Helper (Renderer)'}
VENDOR_NOTICES = {'LICENSE', 'LICENSES.chromium.html', 'version'}
CPU_TYPES = {'arm64': 0x0100000C, 'x64': 0x01000007}
CHUNK = 1024 * 1024
VERIFY_MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
VERIFY_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
VERIFY_MAX_ENTRIES = 20000


def checked_parts(value, *, relative_link=False):
    if (not value or value.startswith('/') or '\\' in value or ':' in value or
            any(unicodedata.category(char) in {'Cc', 'Cs'} for char in value)):
        raise ValueError('Invalid ZIP path')
    parts = tuple(value.split('/'))
    if not all(parts) or (not relative_link and any(part in {'.', '..'} for part in parts)):
        raise ValueError('Noncanonical ZIP path')
    return parts


def folded(parts):
    return tuple(unicodedata.normalize('NFC', unicodedata.normalize('NFD', part).casefold()) for part in parts)


def path_inventory(entries):
    """Inventory explicit ZIP paths and their implied directories."""
    nodes = {}
    names = {}
    recorded = set()
    for parts, kind in entries:
        if parts in recorded:
            raise ValueError('Duplicate ZIP path')
        recorded.add(parts)
        for end in range(1, len(parts)+1):
            component = parts[:end]
            expected = kind if end == len(parts) else 'directory'
            if nodes.setdefault(component, expected) != expected:
                raise ValueError('A non-directory ZIP entry has children')
            if names.setdefault(folded(component), component) != component:
                raise ValueError('Ambiguous case or Unicode ZIP path')
    return nodes


def validate_links(root, nodes, links):
    for source, target in links.items():
        if source[0] != root:
            raise ValueError('Unexpected link outside the app bundle')
        position = list(source[:-1])
        pending = deque(target)
        followed = 0
        while pending:
            part = pending.popleft()
            if part == '.':
                continue
            if part == '..':
                if len(position) == 1:
                    raise ValueError('ZIP link leaves the app bundle')
                position.pop()
                continue
            position.append(part)
            lookup = tuple(position)
            kind = nodes.get(lookup)
            if kind is None or (kind == 'file' and pending):
                raise ValueError('ZIP link target is missing or invalid')
            if kind == 'symlink':
                followed += 1
                if followed > len(links):
                    raise ValueError('Too many nested ZIP links')
                position.pop()
                pending.extendleft(reversed(links[lookup]))


def vendor_inventory(archive):
    entries = {}
    links = {}
    for info in archive.infolist():
        name = info.orig_filename
        parts = checked_parts(name[:-1] if info.is_dir() else name)
        if name != info.filename or parts in entries or info.create_system != 3 or info.flag_bits & 1:
            raise ValueError('Ambiguous or unsupported Electron ZIP entry')
        if info.compress_type not in {ZIP_DEFLATED, ZIP_STORED}:
            raise ValueError('Unsupported Electron ZIP compression')
        mode = stat.S_IFMT(info.external_attr >> 16)
        kind = {stat.S_IFREG: 'file', stat.S_IFLNK: 'symlink', stat.S_IFDIR: 'directory'}.get(mode)
        if kind is None or info.is_dir() != (kind == 'directory') or (info.is_dir() and info.file_size):
            raise ValueError('Invalid UNIX metadata in Electron ZIP')
        if parts[0] != SOURCE_APP and (len(parts) != 1 or parts[0] not in VENDOR_NOTICES or kind != 'file'):
            raise ValueError('Unexpected Electron ZIP root entry')
        entries[parts] = (info, kind)
        if kind == 'symlink':
            if not 0 < info.file_size <= 4096:
                raise ValueError('Invalid Electron ZIP link length')
            links[parts] = checked_parts(archive.read(info).decode('utf-8'), relative_link=True)
    nodes = path_inventory((name, kind) for name, (_, kind) in entries.items())
    if nodes.get((SOURCE_APP,)) != 'directory' or nodes.get(DEFAULT_APP) != 'file' or any((name,) not in entries for name in VENDOR_NOTICES):
        raise ValueError('Incomplete Electron ZIP')
    validate_links(SOURCE_APP, nodes, links)
    return entries, links


def require_file(entries, parts):
    item = entries.get(parts)
    if item is None or item[1] != 'file':
        raise ValueError('Required Electron file is missing')
    return item[0]


def assert_executable(archive, entries, parts, arch, expected_type=2):
    info = require_file(entries, parts)
    with archive.open(info) as source:
        header = source.read(32)
    if len(header) != 32 or not (info.external_attr >> 16) & 0o111:
        raise ValueError('Electron executable is missing UNIX mode or Mach-O header')
    magic, cpu, _, file_type = struct.unpack_from('<IIII', header)
    if magic != 0xFEEDFACF or cpu != CPU_TYPES[arch] or file_type != expected_type:
        raise ValueError('Electron executable has the wrong Mach-O architecture or type')


def read_plist(archive, entries, parts):
    info = require_file(entries, parts)
    if not 0 < info.file_size <= CHUNK:
        raise ValueError('Invalid Electron property list size')
    contents = archive.read(info)
    values = plistlib.loads(contents)
    if not isinstance(values, dict):
        raise ValueError('Invalid Electron property list')
    return values, plistlib.FMT_BINARY if contents.startswith(b'bplist00') else plistlib.FMT_XML


def bundle_changes(archive, entries, arch, version):
    main = (SOURCE_APP, 'Contents')
    main_plist = (*main, 'Info.plist')
    main_executable = (*main, 'MacOS', 'Electron')
    assert_executable(archive, entries, main_executable, arch)
    settings, fmt = read_plist(archive, entries, main_plist)
    original_id = settings.get('CFBundleIdentifier')
    if original_id != 'com.github.Electron' or settings.get('CFBundleExecutable') != 'Electron':
        raise ValueError('Unexpected main Electron bundle configuration')
    settings.update(CFBundleIdentifier=BUNDLE_ID, CFBundleExecutable='Shenyi', CFBundleName='Shenyi',
                    CFBundleDisplayName='审易', CFBundleShortVersionString=version, CFBundleVersion=version)
    integrity = settings.get('ElectronAsarIntegrity')
    if isinstance(integrity, dict) and '/'.join(DEFAULT_APP[2:]) in integrity:
        del integrity['/'.join(DEFAULT_APP[2:])]
        if not integrity:
            del settings['ElectronAsarIntegrity']
    changed = {main_plist: plistlib.dumps(settings, fmt=fmt, sort_keys=False)}
    renamed = {main_executable: (*main, 'MacOS', 'Shenyi')}
    support = {}
    for parts in entries:
        parent = parts[:-1]
        if parent == HELPERS and re.fullmatch(r'Electron Helper(?: \([A-Za-z0-9 -]+\))?\.app', parts[-1]):
            support[parts] = parts[-1][:-4]
        elif parent == LOGIN_ITEMS and parts[-1] == 'Electron Login Helper.app':
            support[parts] = parts[-1][:-4]
    if not REQUIRED_HELPERS.issubset(support.values()):
        raise ValueError('Required Electron helpers are missing')
    for root, original in support.items():
        helper_plist = (*root, 'Contents', 'Info.plist')
        executable = (*root, 'Contents', 'MacOS', original)
        assert_executable(archive, entries, executable, arch)
        settings, fmt = read_plist(archive, entries, helper_plist)
        previous_id = settings.get('CFBundleIdentifier')
        if (not isinstance(previous_id, str) or not previous_id.startswith(original_id+'.') or
                not re.fullmatch(r'(?:\.[a-zA-Z0-9_-]+)+', previous_id[len(original_id):]) or
                settings.get('CFBundleExecutable', original) != original):
            raise ValueError('Unexpected Electron helper configuration')
        branded = 'Shenyi' + original[len('Electron'):]
        settings.update(CFBundleIdentifier=BUNDLE_ID+previous_id[len(original_id):], CFBundleExecutable=branded,
                        CFBundleName=branded, CFBundleDisplayName=branded)
        renamed[root] = (*root[:-1], branded+'.app')
        renamed[executable] = (*executable[:-1], branded)
        changed[helper_plist] = plistlib.dumps(settings, fmt=fmt, sort_keys=False)
    return renamed, support, changed


def output_name(parts, renamed, support):
    if parts[0] != SOURCE_APP:
        return parts
    parts = renamed.get(parts, parts)
    for root in support:
        if parts[:len(root)] == root:
            parts = (*renamed[root], *parts[len(root):])
            break
    return (APP, *parts[1:])


def plain_entry(info):
    return not (getattr(info, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def abort_walk(error):
    raise error


def payload_inventory(root):
    initial = root.lstat()
    if not stat.S_ISDIR(initial.st_mode) or not plain_entry(initial):
        raise ValueError('App payload directory is invalid')
    entries = [(PAYLOAD, root, initial, 'directory')]
    for folder, directories, files in os.walk(root, onerror=abort_walk):
        directories.sort()
        for name in sorted(directories+files):
            source = Path(folder)/name
            parts = (*PAYLOAD, *checked_parts(source.relative_to(root).as_posix()))
            info = source.lstat()
            if not plain_entry(info):
                raise ValueError('App payload contains a filesystem link')
            if stat.S_ISDIR(info.st_mode):
                kind = 'directory'
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                kind = 'file'
            else:
                raise ValueError('App payload contains a non-regular or linked file')
            if (kind == 'directory') != (name in directories):
                raise ValueError('App payload changed while inspecting')
            entries.append((parts, source, info, kind))
    if not any(name == (*PAYLOAD, 'package.json') and kind == 'file' for name, _, _, kind in entries):
        raise ValueError('App payload is missing package.json')
    return entries


def archive_name(parts, kind):
    return '/'.join(parts) + ('/' if kind == 'directory' else '')


def write_vendor(output, source, info, final_name, changed):
    entry = copy(info)
    entry.filename = entry.orig_filename = final_name
    if changed is not None:
        output.writestr(entry, changed)
        return
    with source.open(info) as contents, output.open(entry, 'w') as member:
        copyfileobj(contents, member, CHUNK)


def unchanged(before, after, *, compare_ctime=True):
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns')
    return (all(getattr(before, field) == getattr(after, field) for field in fields) and
            (not compare_ctime or before.st_ctime_ns == after.st_ctime_ns))


def write_payload(output, parts, source, info, kind):
    entry = ZipInfo(archive_name(parts, kind))
    entry.create_system = 3
    if kind == 'directory':
        entry.external_attr = ((stat.S_IFDIR | 0o755) << 16) | 0x10
        output.writestr(entry, b'')
        return
    entry.external_attr = (stat.S_IFREG | 0o644) << 16
    entry.compress_type = ZIP_DEFLATED
    entry.file_size = info.st_size
    fd = os.open(source, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as contents:
        descriptor = os.fstat(contents.fileno())
        listed = source.lstat()
        # On Windows, lstat and fstat can report different ctime values for
        # Node-copied files. Compare each ctime with its own API's baseline.
        if (not unchanged(info, descriptor, compare_ctime=os.name != 'nt') or
                not plain_entry(listed) or not unchanged(info, listed)):
            raise ValueError('App payload changed before packaging')
        with output.open(entry, 'w') as member:
            copyfileobj(contents, member, CHUNK)
        listed = source.lstat()
        if (not unchanged(descriptor, os.fstat(contents.fileno())) or
                not plain_entry(listed) or not unchanged(info, listed)):
            raise ValueError('App payload changed during packaging')


def write_archive(filename, archive, vendor, payload, changed):
    created = None
    try:
        with filename.open('xb') as handle:
            created = os.fstat(handle.fileno())
            with ZipFile(handle, 'w') as output:
                for path, name, info, kind in vendor:
                    write_vendor(output, archive, info, archive_name(name, kind), changed.get(path))
                for parts, source, info, kind in payload:
                    write_payload(output, parts, source, info, kind)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        if created is not None:
            try:
                current = filename.lstat()
                if stat.S_ISREG(current.st_mode) and os.path.samestat(current, created):
                    filename.unlink()
            except OSError:
                pass
        raise


def build(electron_archive, payload_dir, output_zip, arch, version):
    if not re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', version):
        raise ValueError('Expected a three-component release version')
    payload = payload_inventory(payload_dir)
    with ZipFile(electron_archive) as archive:
        entries, links = vendor_inventory(archive)
        renamed, support, changed = bundle_changes(archive, entries, arch, version)
        vendor = [(parts, output_name(parts, renamed, support), info, kind)
                  for parts, (info, kind) in entries.items() if parts != DEFAULT_APP]
        nodes = path_inventory([(name, kind) for _, name, _, kind in vendor] +
                               [(name, kind) for name, _, _, kind in payload])
        validate_links(APP, nodes, {output_name(parts, renamed, support):target for parts, target in links.items()})
        write_archive(output_zip, archive, vendor, payload, changed)
    return {'archiveEntries': len(vendor)+len(payload), 'symlinks': len(links),
            'appFiles': sum(kind == 'file' for _, _, _, kind in payload), 'bundleIdentifier': BUNDLE_ID}


def checked_version(version):
    if not re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', version):
        raise ValueError('Expected a three-component release version')


def verify_zip_envelope(handle, size):
    """Bound central-directory allocation before ZipFile reads untrusted metadata."""
    if not 22 <= size <= VERIFY_MAX_ARCHIVE_BYTES:
        raise ValueError('Mac desktop archive exceeds the bounded ZIP size')
    handle.seek(size - 22)
    end = handle.read(22)
    signature, disk, directory_disk, disk_count, count, directory_size, directory_offset, comment = struct.unpack('<4s4H2LH', end)
    if (signature != b'PK\x05\x06' or disk or directory_disk or comment or disk_count != count or
            not 1 <= count <= VERIFY_MAX_ENTRIES or directory_size > 16 * CHUNK or
            directory_offset + directory_size != size - 22):
        raise ValueError('Unsupported, trailing, split, ZIP64 or oversized ZIP metadata')
    handle.seek(0)
    return count


def candidate_inventory(archive, expected_count, archive_size):
    entries = {}
    links = {}
    total = 0
    infos = archive.infolist()
    if len(infos) != expected_count or archive.comment or min(info.header_offset for info in infos) != 0:
        raise ValueError('Unexpected Mac ZIP envelope')
    for info in infos:
        name = info.orig_filename
        parts = checked_parts(name[:-1] if info.is_dir() else name)
        if (name != info.filename or len(name) > 4096 or info.create_system != 3 or info.flag_bits & 1 or
                info.compress_type not in {ZIP_DEFLATED, ZIP_STORED} or
                not 0 <= info.file_size <= VERIFY_MAX_ARCHIVE_BYTES or
                not 0 <= info.compress_size <= archive_size or not 0 <= info.header_offset < archive_size):
            raise ValueError('Unsupported Mac ZIP entry metadata')
        total += info.file_size
        if total > VERIFY_MAX_UNCOMPRESSED_BYTES:
            raise ValueError('Mac ZIP expands beyond the bounded total size')
        mode = stat.S_IFMT(info.external_attr >> 16)
        kind = {stat.S_IFREG: 'file', stat.S_IFLNK: 'symlink', stat.S_IFDIR: 'directory'}.get(mode)
        if kind is None or info.is_dir() != (kind == 'directory') or (kind == 'directory' and info.file_size):
            raise ValueError('Invalid Mac ZIP UNIX metadata')
        if parts[0] != APP and (len(parts) != 1 or parts[0] not in VENDOR_NOTICES or kind != 'file'):
            raise ValueError('Unexpected Mac ZIP root entry')
        if parts in entries:
            raise ValueError('Duplicate Mac ZIP entry')
        entries[parts] = (info, kind)
    nodes = path_inventory((parts, kind) for parts, (_, kind) in entries.items())
    if (nodes.get((APP,)) != 'directory' or any(nodes.get((name,)) != 'file' for name in VENDOR_NOTICES) or
            nodes.get((APP, *RESOURCES, 'default_app.asar')) is not None or
            nodes.get((APP, 'Contents', 'MacOS', 'Electron')) is not None):
        raise ValueError('Incomplete or unbranded Mac desktop archive')
    for parts, (info, kind) in entries.items():
        if kind == 'symlink':
            if not 0 < info.file_size <= 4096 or parts[:len(PAYLOAD)] == PAYLOAD:
                raise ValueError('Invalid Mac ZIP symlink')
            links[parts] = checked_parts(archive.read(info).decode('utf-8'), relative_link=True)
    validate_links(APP, nodes, links)
    return entries, nodes, links


def unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate application package JSON key')
        result[key] = value
    return result


def verify_candidate_contents(archive, entries, nodes, arch, version):
    main = (APP, 'Contents')
    assert_executable(archive, entries, (*main, 'MacOS', 'Shenyi'), arch)
    framework = (*main, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A')
    # Check the regular Mach-O target, not the outer framework symlink bytes.
    assert_executable(archive, entries, (*framework, 'Electron Framework'), arch, expected_type=6)
    for library in ('libffmpeg.dylib', 'libvk_swiftshader.dylib'):
        assert_executable(archive, entries, (*framework, 'Libraries', library), arch, expected_type=6)
    settings, _ = read_plist(archive, entries, (*main, 'Info.plist'))
    if (settings.get('CFBundleIdentifier') != BUNDLE_ID or settings.get('CFBundleExecutable') != 'Shenyi' or
            settings.get('CFBundleName') != 'Shenyi' or settings.get('CFBundlePackageType') != 'APPL' or
            settings.get('CFBundleShortVersionString') != version or settings.get('CFBundleVersion') != version):
        raise ValueError('Mac application plist does not match the candidate version or identity')
    package_info = require_file(entries, (*PAYLOAD, 'package.json'))
    if not 0 < package_info.file_size <= 16384:
        raise ValueError('Invalid application package metadata size')
    package = json.loads(archive.read(package_info).decode('utf-8'), object_pairs_hook=unique_json)
    if (not isinstance(package, dict) or package.get('name') != 'shenyi-team-desktop' or
            package.get('version') != version or package.get('private') is not True or
            package.get('main') != 'desktop/main.cjs'):
        raise ValueError('Application package does not match the candidate version or entry point')
    for relative in (('desktop', 'main.cjs'), ('desktop', 'preload.cjs'), ('desktop', 'team-ui', 'index.html'),
                     ('package-lock.json',), ('node_modules', 'jsdom', 'package.json')):
        require_file(entries, (*PAYLOAD, *relative))
    helpers = {}
    for parts, kind in nodes.items():
        if kind != 'directory':
            continue
        parent = parts[:-1]
        if (parent == (APP, 'Contents', 'Frameworks') and
                re.fullmatch(r'Shenyi Helper(?: \([A-Za-z0-9 -]+\))?\.app', parts[-1])) or (
                parent == (APP, 'Contents', 'Library', 'LoginItems') and parts[-1] == 'Shenyi Login Helper.app'):
            helpers[parts] = parts[-1][:-4]
    required = {name.replace('Electron', 'Shenyi', 1) for name in REQUIRED_HELPERS}
    if not required.issubset(helpers.values()) or len(helpers) > 16:
        raise ValueError('Required branded Mac helpers are missing or excessive')
    for root, name in helpers.items():
        assert_executable(archive, entries, (*root, 'Contents', 'MacOS', name), arch)
        helper, _ = read_plist(archive, entries, (*root, 'Contents', 'Info.plist'))
        helper_id = helper.get('CFBundleIdentifier')
        if (not isinstance(helper_id, str) or not helper_id.startswith(BUNDLE_ID + '.') or
                not re.fullmatch(r'(?:\.[a-zA-Z0-9_-]+)+', helper_id[len(BUNDLE_ID):]) or
                helper.get('CFBundleExecutable') != name or helper.get('CFBundleName') != name):
            raise ValueError('Invalid branded Mac helper identity')


def verify_archive(filename, arch, version):
    """Read ZIP and hash the same held file; never extract or execute its contents."""
    checked_version(version)
    if not filename.is_absolute() or filename.resolve(strict=True) != filename:
        raise ValueError('Expected a canonical absolute Mac archive path')
    listed = filename.lstat()
    if not stat.S_ISREG(listed.st_mode) or listed.st_nlink != 1 or not plain_entry(listed):
        raise ValueError('Mac archive must be a regular, unlinked file')
    fd = os.open(filename, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as handle:
        initial = os.fstat(handle.fileno())
        if not unchanged(listed, initial, compare_ctime=os.name != 'nt'):
            raise ValueError('Mac archive changed before verification')
        count = verify_zip_envelope(handle, initial.st_size)
        with ZipFile(handle) as archive:
            entries, nodes, links = candidate_inventory(archive, count, initial.st_size)
            verify_candidate_contents(archive, entries, nodes, arch, version)
            # Bounded streaming validates every local header, expansion length and CRC.
            for info, _ in entries.values():
                consumed = 0
                with archive.open(info) as member:
                    while data := member.read(CHUNK):
                        consumed += len(data)
                        if consumed > info.file_size:
                            raise ValueError('Mac ZIP member exceeds its declared length')
                if consumed != info.file_size:
                    raise ValueError('Mac ZIP member length differs from its declaration')
        handle.seek(0)
        digest = hashlib.sha256()
        size = 0
        while data := handle.read(CHUNK):
            size += len(data)
            if size > initial.st_size:
                raise ValueError('Mac archive grew during verification')
            digest.update(data)
        final = filename.lstat()
        if (size != initial.st_size or not unchanged(initial, os.fstat(handle.fileno())) or
                not plain_entry(final) or not unchanged(listed, final) or filename.resolve(strict=True) != filename):
            raise ValueError('Mac archive changed during verification')
    return {'archiveEntries': len(entries), 'symlinks': len(links),
            'appFiles': sum(kind == 'file' and parts[:len(PAYLOAD)] == PAYLOAD for parts, (_, kind) in entries.items()),
            'bundleIdentifier': BUNDLE_ID, 'archiveSha256': digest.hexdigest(), 'archiveBytes': size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    verify_only = len(sys.argv) > 1 and sys.argv[1] == '--verify'
    if verify_only:
        parser.add_argument('--verify', required=True, type=Path)
    else:
        parser.add_argument('electron_archive', type=Path)
        parser.add_argument('payload_dir', type=Path)
        parser.add_argument('output_zip', type=Path)
    parser.add_argument('arch', choices=CPU_TYPES)
    parser.add_argument('version')
    args = parser.parse_args()
    try:
        result = (verify_archive(args.verify, args.arch, args.version) if verify_only else
                  build(args.electron_archive, args.payload_dir, args.output_zip, args.arch, args.version))
    except (OSError, ValueError, BadZipFile, plistlib.InvalidFileException) as error:
        print(f'Mac desktop archive {"verification" if verify_only else "build"} failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
