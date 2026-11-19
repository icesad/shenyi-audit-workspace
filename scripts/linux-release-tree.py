"""Fingerprint a read-only staged Linux release before it is executed."""

import hashlib
import json
import os
from pathlib import Path
import stat


MAX_ENTRIES = 32768
MAX_BYTES = 512 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _snapshot(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _file_digest(parent_fd, name, info, relative):
    message = f'Staged release file changed during verification: {relative}'
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    descriptor = os.open(name, flags, dir_fd=parent_fd)
    with os.fdopen(descriptor, 'rb', buffering=0) as source:
        _require(_snapshot(os.fstat(source.fileno())) == _snapshot(info), message)
        digest = hashlib.sha256()
        remaining = info.st_size
        while remaining:
            chunk = source.read(min(CHUNK_BYTES, remaining))
            _require(bool(chunk), message)
            digest.update(chunk)
            remaining -= len(chunk)
        _require(not source.read(1) and _snapshot(os.fstat(source.fileno())) == _snapshot(info), message)
    return digest.hexdigest()


def staged_tree(root: Path, owner_uid: int, receipt_name: str) -> dict:
    """Include the root directory and receipt mode, excluding only receipt content."""
    _require(root.is_absolute() and root.resolve(strict=True) == root and type(owner_uid) is int
             and owner_uid >= 0 and isinstance(receipt_name, str) and len(Path(receipt_name).parts) == 1
             and receipt_name not in {'', '.', '..'} and Path(receipt_name).name == receipt_name,
             'Use a real absolute staged root and a single receipt filename.')
    root_info = root.lstat()
    root_device = root_info.st_dev
    entries = {}
    directory_identities = set()
    pending_entries = 1
    counts = {'files': 0, 'directories': 0, 'bytes': 0}
    digest = hashlib.sha256(b'shenyi-linux-staged-tree-v1\n')

    def verify_entry(info, relative):
        message = f'Untrusted staged release entry: {relative or "."}'
        _require(info.st_dev == root_device and info.st_uid == owner_uid and not info.st_mode & 0o7222, message)
        if stat.S_ISDIR(info.st_mode):
            _require((info.st_dev, info.st_ino) not in directory_identities, message)
        else:
            _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size >= 0, message)

    def inspect_directory(parent_fd, name, info, relative):
        nonlocal pending_entries
        verify_entry(info, relative)
        _require(stat.S_ISDIR(info.st_mode), f'Expected a staged release directory: {relative or "."}')
        descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            expected = _snapshot(info)
            changed = f'Staged release directory changed during verification: {relative or "."}'
            _require(_snapshot(os.fstat(descriptor)) == expected, changed)
            directory_identities.add((info.st_dev, info.st_ino))
            entries[relative] = (expected, [relative, 'directory', stat.S_IMODE(info.st_mode)])
            counts['directories'] += 1
            names = []
            with os.scandir(descriptor) as listing:
                for entry in listing:
                    pending_entries += 1
                    _require(pending_entries <= MAX_ENTRIES, 'Staged release exceeds the entry limit.')
                    names.append(entry.name)
            for child_name in names:
                child_relative = relative + '/' + child_name if relative else child_name
                child = os.stat(child_name, dir_fd=descriptor, follow_symlinks=False)
                if child_relative == receipt_name:
                    verify_entry(child, child_relative)
                    _require(stat.S_ISREG(child.st_mode), 'Expected a regular staged release receipt.')
                    row = [child_relative, 'receipt', stat.S_IMODE(child.st_mode)]
                elif stat.S_ISDIR(child.st_mode):
                    inspect_directory(descriptor, child_name, child, child_relative)
                    continue
                else:
                    verify_entry(child, child_relative)
                    counts['files'] += 1
                    counts['bytes'] += child.st_size
                    _require(counts['bytes'] <= MAX_BYTES, 'Staged release exceeds the byte limit.')
                    row = [child_relative, 'file', stat.S_IMODE(child.st_mode), child.st_size,
                           _file_digest(descriptor, child_name, child, child_relative)]
                entries[child_relative] = (_snapshot(child), row)
            _require(_snapshot(os.fstat(descriptor)) == expected, changed)
            if parent_fd is None:
                verify_snapshots(descriptor)
        finally:
            os.close(descriptor)

    def verify_snapshots(root_fd):
        _require(receipt_name in entries, 'The staged release receipt is missing.')
        for relative in sorted(entries, key=lambda path: path.encode('utf-8')):
            expected, row = entries[relative]
            current = (os.stat(relative, dir_fd=root_fd, follow_symlinks=False) if relative else root.lstat())
            _require(_snapshot(current) == expected,
                     f'Staged release entry changed during verification: {relative or "."}')
            digest.update(json.dumps(row, ensure_ascii=False, separators=(',', ':')).encode('utf-8') + b'\n')

    try:
        inspect_directory(None, root, root_info, '')
    except RecursionError as error:
        raise ValueError('Staged release directory nesting exceeds the supported limit.') from error
    return {'version': 1, 'sha256': digest.hexdigest(), **counts}
