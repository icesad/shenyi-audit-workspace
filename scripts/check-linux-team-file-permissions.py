#!/usr/bin/env python3
"""Check the managed Linux service's file permissions before first startup."""

import errno
import json
import os
from pathlib import Path
import stat
import sys


CONFIG_ROOT = Path('/etc/shenyi-team')
CONFIG = CONFIG_ROOT / 'service.json'
STATE_ROOT = Path('/var/lib/shenyi-team')
SERVICE_ACCOUNT = 'shenyi-team'


class CheckFailed(Exception):
    def __init__(self, check, code):
        super().__init__(check, code)
        self.check = check
        self.code = code


def require(condition, check, code):
    if not condition:
        raise CheckFailed(check, code)


def entry(path, check, *, directory=False, optional=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if optional:
            return None
        raise CheckFailed(check, 'MISSING') from None
    except OSError:
        raise CheckFailed(check, 'METADATA_UNAVAILABLE') from None
    if directory:
        require(stat.S_ISDIR(info.st_mode), check, 'UNSAFE_TYPE_OR_LINK')
    else:
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, check, 'UNSAFE_TYPE_OR_LINK')
    return info


def check_acl(path, check, *, directory=False):
    attributes = ('system.posix_acl_access', 'system.posix_acl_default') if directory else ('system.posix_acl_access',)
    for name in attributes:
        try:
            os.getxattr(path, name, follow_symlinks=False)
        except OSError as error:
            if error.errno == errno.ENODATA:
                continue
            raise CheckFailed(check, 'ACL_UNAVAILABLE') from None
        raise CheckFailed(check, 'EXTENDED_ACL')


def identity(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink


def trusted_ancestors(path, groups, check):
    for ancestor in reversed(path.parents):
        info = entry(ancestor, check, directory=True)
        mode = stat.S_IMODE(info.st_mode)
        traversal = stat.S_IXGRP if info.st_gid in groups else stat.S_IXOTH
        require(info.st_uid == 0 and not mode & 0o022 and mode & traversal, check, 'ANCESTOR_PERMISSIONS')
        check_acl(ancestor, check, directory=True)


def private_directory(path, group, check):
    info = entry(path, check, directory=True)
    mode = stat.S_IMODE(info.st_mode)
    require(info.st_uid == 0 and info.st_gid == group and mode in (0o510, 0o550, 0o710, 0o750),
            check, 'DIRECTORY_PERMISSIONS')
    check_acl(path, check, directory=True)


def root_file(path, group, groups, check, *, secret):
    trusted_ancestors(path, groups, check)
    if secret:
        private_directory(path.parent, group, check)
    info = entry(path, check)
    mode = stat.S_IMODE(info.st_mode)
    if secret:
        valid_mode = info.st_gid == group and mode in (0o440, 0o640)
    else:
        read_bit = stat.S_IRGRP if info.st_gid in groups else stat.S_IROTH
        valid_mode = not mode & ~0o644 and bool(mode & read_bit)
    require(info.st_uid == 0 and valid_mode, check, 'FILE_PERMISSIONS')
    check_acl(path, check)
    return info


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate key')
        result[key] = value
    return result


def configured_paths(group, groups):
    check = 'configuration'
    expected = root_file(CONFIG, group, groups, check, secret=True)
    try:
        fd = os.open(CONFIG, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            first = os.fstat(stream.fileno())
            require(identity(first) == identity(expected), check, 'CHANGED_DURING_CHECK')
            data = stream.read(16 * 1024 + 1)
            after = os.fstat(stream.fileno())
            require(identity(first) == identity(after)
                    and first.st_size == after.st_size and first.st_mtime_ns == after.st_mtime_ns
                    and first.st_ctime_ns == after.st_ctime_ns
                    and identity(first) == identity(entry(CONFIG, check)), check, 'CHANGED_DURING_CHECK')
        if len(data) > 16 * 1024:
            raise ValueError('Profile too large')
        profile = json.loads(data.decode('utf-8'), object_pairs_hook=unique_object)
    except (OSError, ValueError, RecursionError):
        raise CheckFailed(check, 'INVALID_CONFIGURATION') from None
    require(isinstance(profile, dict), check, 'INVALID_CONFIGURATION')
    paths = {}
    mandatory = ('database', 'tlsCertificate', 'tlsKey')
    for key in (*mandatory, 'smsProfile', 'wechatProfile'):
        if key not in profile and key not in mandatory:
            continue
        value = profile.get(key)
        require(isinstance(value, str) and value.startswith('/') and not value.startswith('//')
                and not any(ord(char) < 32 or ord(char) == 127 or 0xD800 <= ord(char) <= 0xDFFF for char in value)
                and not any(part in ('', '.', '..') for part in value[1:].split('/')), key, 'UNSAFE_PATH')
        paths[key] = Path(value)
    all_paths = [CONFIG, *paths.values()]
    require(len(set(all_paths)) == len(all_paths), check, 'SHARED_PATH')
    return paths


def check_database(path, user, group, groups):
    check = 'database'
    require(path.is_relative_to(STATE_ROOT) and path != STATE_ROOT, check, 'UNSAFE_PATH')
    trusted_ancestors(STATE_ROOT, groups, check)
    for folder in (STATE_ROOT, *[p for p in reversed(path.parents) if p != STATE_ROOT and p.is_relative_to(STATE_ROOT)]):
        info = entry(folder, check, directory=True)
        require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (user, group, 0o700),
                check, 'DIRECTORY_PERMISSIONS')
        check_acl(folder, check, directory=True)
    sidecars = {}
    for suffix in ('', '-journal', '-wal', '-shm'):
        label = check + suffix
        target = path.with_name(path.name + suffix)
        info = entry(target, label, optional=bool(suffix))
        if info is not None:
            require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (user, group, 0o600),
                    label, 'FILE_PERMISSIONS')
            check_acl(target, label)
        if suffix:
            sidecars[suffix[1:]] = 'pass' if info is not None else 'absent'
    return sidecars


def audit():
    import grp
    import pwd

    try:
        account = pwd.getpwnam(SERVICE_ACCOUNT)
        group = grp.getgrnam(SERVICE_ACCOUNT).gr_gid
        groups = set(os.getgrouplist(SERVICE_ACCOUNT, group))
    except KeyError:
        raise CheckFailed('serviceAccount', 'ACCOUNT_MISSING') from None
    except OSError:
        raise CheckFailed('serviceAccount', 'ACCOUNT_UNAVAILABLE') from None
    require(account.pw_uid > 0 and group > 0 and account.pw_gid == group, 'serviceAccount', 'ACCOUNT_MISMATCH')
    paths = configured_paths(group, groups)
    checks = {'configuration': 'pass', 'serviceAccount': 'pass'}
    for key in ('tlsCertificate', 'tlsKey', 'smsProfile', 'wechatProfile'):
        if key in paths:
            root_file(paths[key], group, groups, key, secret=key != 'tlsCertificate')
        checks[key] = 'pass' if key in paths else 'not-configured'
    checks['sqliteSidecars'] = check_database(paths['database'], account.pw_uid, group, groups)
    checks['database'] = 'pass'
    return {'status': 'pass', 'checks': checks}


def main():
    try:
        require(sys.platform == 'linux' and os.geteuid() == 0, 'environment', 'LINUX_ADMIN_REQUIRED')
        require(len(sys.argv) == 1, 'arguments', 'UNEXPECTED_ARGUMENT')
        print(json.dumps(audit()))
    except CheckFailed as error:
        print(json.dumps({'status': 'failed', 'check': error.check, 'code': error.code}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
