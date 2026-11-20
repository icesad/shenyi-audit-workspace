#!/usr/bin/env python3
"""Activate or recover a schema-compatible release on a managed Linux host."""

import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
from runpy import run_path
import stat
import subprocess
import sys
import tempfile
import time


ROOT = Path('/opt/shenyi-team')
CURRENT = ROOT / 'current'
NODE = ROOT / 'node/bin/node'
CONFIG = Path('/etc/shenyi-team/service.json')
BACKEND_CA = Path('/etc/nginx/shenyi-team/backend-ca.pem')
UNIT = 'shenyi-team.service'
UNIT_PATH = '/etc/systemd/system/shenyi-team.service'
JOURNAL = ROOT / '.shenyi-activation.json'
RECEIPT = '.shenyi-stage-receipt.json'
staged_tree = run_path(str(Path(__file__).resolve().with_name('linux-release-tree.py')))['staged_tree']
SYSTEMCTL = Path('/usr/bin/systemctl')
RUNUSER = Path('/usr/sbin/runuser')
TIMEOUT = Path('/usr/bin/timeout')
HEALTH_KEYS = {
    'backendReadiness', 'backendIdentity', 'publicIdentity', 'publicReadinessHidden', 'publicHealthHidden',
    'backendCertificate', 'publicCertificate', 'tlsKeySeparation', 'databaseVolume',
}
ADVISORY_KEYS = {'backendCertificate', 'publicCertificate', 'databaseVolume'}
RECOVERY_LAYOUTS = {
    # (current holds the old release, name of the other directory)
    'stopping-current': {(True, 'staged')},
    # An automatic rollback may continue if it could not replace the journal.
    'exchanging-directories': {(True, 'staged'), (False, 'staged'), (True, 'failed')},
    'starting-candidate': {(False, 'staged'), (False, 'previous'), (True, 'staged'), (True, 'failed')},
    'restoring-current': {(False, 'staged'), (True, 'staged'), (True, 'failed')},
    'recovering-current': {(False, 'staged'), (False, 'previous'),
                           (True, 'staged'), (True, 'previous'), (True, 'failed')},
    'activated': {(False, 'previous')},
    'rolled-back': {(True, 'failed')},
    'recovered': {(True, 'failed')},
}
TERMINAL_STATES = {'activated', 'rolled-back', 'recovered'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def owned_path(path, kind, readonly=False):
    value = path.lstat()
    require(path.resolve(strict=True) == path and kind(value.st_mode) and value.st_uid == 0
            and not value.st_mode & (0o222 if readonly else 0o022), f'Untrusted deployment path: {path}')
    return value


def identity(value):
    return [value.st_dev, value.st_ino]


def read_file(path, limit):
    with path.open('rb') as handle:
        data = handle.read(limit + 1)
    require(len(data) <= limit, f'Unexpected metadata size: {path}')
    return data


def configuration_stamp():
    owned_path(CONFIG, stat.S_ISREG)
    source = read_file(CONFIG, 64 * 1024)
    current = json.loads(source)
    database = Path(current['database'])
    info = database.lstat()
    require(database.is_absolute() and database.resolve(strict=True) == database and stat.S_ISREG(info.st_mode),
            'The active service must use a real SQLite file.')
    return {'configSha256': hashlib.sha256(source).hexdigest(), 'databaseIdentity': identity(info)}


def startup_input_stamp():
    # The service loads these files separately. Keep their metadata in memory
    # only; durable recovery continues to use the configuration and DB stamp.
    def file_state(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    listed = owned_path(CONFIG, stat.S_ISREG)
    profile = json.loads(read_file(CONFIG, 64 * 1024))
    inputs = [file_state(listed)]
    for field in ('tlsCertificate', 'tlsKey', 'smsProfile', 'wechatProfile', 'wechatNativeCallbackProfile'):
        filename = profile.get(field)
        try:
            info = Path(filename).lstat() if isinstance(filename, str) and Path(filename).is_absolute() else None
        except (OSError, ValueError):
            # Missing or malformed references are still diagnosed by the candidate.
            info = None
        inputs.append(file_state(info) if info is not None else None)
    return tuple(inputs)


def run(command, timeout, env):
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, env=env)


def service(args, env, timeout=15):
    result = run([SYSTEMCTL, '--no-pager', *args, UNIT], timeout, env)
    require(result.returncode == 0, f'systemd {args[0]} failed.')
    return result.stdout


def service_status(env):
    fields = ('LoadState', 'ActiveState', 'MainPID', 'ControlPID', 'InvocationID', 'Job',
              'User', 'FragmentPath', 'WorkingDirectory')
    status = dict(line.split('=', 1) for line in service(['show', *[f'--property={field}' for field in fields]], env)
                  .splitlines() if '=' in line)
    require(status.get('LoadState') == 'loaded' and status.get('FragmentPath') == UNIT_PATH
            and status.get('User') == 'shenyi-team' and status.get('WorkingDirectory') == str(CURRENT),
            'Unexpected team-service unit, working directory or account.')
    return status


def process_status(env):
    status = service_status(env)
    pid = int(status.get('MainPID', 0))
    invocation = status.get('InvocationID', '')
    require(status.get('ActiveState') == 'active' and pid > 0 and re.fullmatch(r'[0-9a-f]{32}', invocation),
            'The team service does not have an active invocation.')
    real_root = identity((Path('/proc') / str(pid) / 'cwd').stat())
    real_node = identity((Path('/proc') / str(pid) / 'exe').stat())
    require(real_root == identity(CURRENT.stat()) and real_node == identity(NODE.stat()),
            'The active process does not match the expected release and runtime.')
    return pid, invocation


def stopped(status):
    return (status.get('ActiveState') in {'inactive', 'failed'} and status.get('MainPID') == '0'
            and status.get('ControlPID') == '0' and status.get('Job', '') in {'', '0', '/'})


def stop_service(env):
    service(['stop'], env, timeout=75)
    require(stopped(service_status(env)),
            'The service did not stop cleanly. Preserve the release paths for review.')


def restart_previous(env):
    result = run([SYSTEMCTL, '--no-pager', 'reset-failed', UNIT], 15, env)
    # systemd may unload this inactive unit after the completed stop job.
    unloaded = f'Failed to reset failed state of unit {UNIT}: Unit {UNIT} not loaded.'
    require(result.returncode == 0 or result.stderr.strip() == unloaded,
            'Could not reset the stopped team-service failure state.')
    service(['start'], env, timeout=45)
    return 'cleared' if result.returncode == 0 else 'already-unloaded'


def health_check(env, prior_warnings, limit, probe_root=CURRENT):
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        try:
            process = process_status(env)
            check = run([NODE, probe_root / 'scripts/check-team-service.mjs', '--config', CONFIG,
                         '--backend-ca', BACKEND_CA], 15, env)
            report = json.loads(check.stdout)
            checks = report['checks']
            warnings = {name for name, row in checks.items() if row['status'] == 'warning'}
            statuses = {row['status'] for row in checks.values()}
            require(checks.keys() == HEALTH_KEYS and statuses <= {'pass', 'warning'} and warnings <= ADVISORY_KEYS
                    and (prior_warnings is None or warnings <= prior_warnings)
                    and (check.returncode, report['status']) == ((2, 'warning') if warnings else (0, 'healthy'))
                    and process == process_status(env), 'Required dual HTTPS checks failed.')
            return report, warnings, process
        except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.TimeoutExpired):
            time.sleep(1)
    raise ValueError('The service failed the dual HTTPS readiness check.')


def record(path, data, root_fd):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', prefix='.shenyi-activation-', dir=ROOT,
                                    delete=False) as file:
        json.dump(data, file)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    os.replace(file.name, path)
    os.fsync(root_fd)


def rename_operation():
    rename = ctypes.CDLL(None, use_errno=True).renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    return rename


def rename_entry(rename, root_fd, source, target, flags):
    if rename(root_fd, os.fsencode(source.name), root_fd, os.fsencode(target.name), flags) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(source))


def validate_stage(staged, revision, archive_sha, root_device, *, receipt_stage=None, recovery_journal=None):
    info = owned_path(staged, stat.S_ISDIR, readonly=True)
    require(info.st_dev == root_device, 'The staged release must be on the release filesystem.')
    path = staged / RECEIPT
    owned_path(path, stat.S_ISREG, readonly=True)
    receipt = json.loads(read_file(path, 16 * 1024))
    require(receipt['ok'] is True and receipt['offline'] is True
            and receipt['stageDir'] == str(receipt_stage if receipt_stage is not None else staged)
            and receipt['archive']['revision'] == revision and receipt['archive']['sha256'] == archive_sha,
            'The staged receipt does not match the approved revision and archive digest.')
    lock = staged / 'package-lock.json'
    owned_path(lock, stat.S_ISREG, readonly=True)
    require(hashlib.sha256(read_file(lock, 16 * 1024 * 1024)).hexdigest() == receipt['packageLockSha256'],
            'The staged lockfile has changed.')
    legacy_recovery = (recovery_journal is not None and 'stagedTree' not in recovery_journal
                       and 'stagedTree' not in receipt)
    if legacy_recovery:
        for directory, directories, files in os.walk(staged, followlinks=False):
            for child in directories:
                owned_path(Path(directory) / child, stat.S_ISDIR, readonly=True)
            for file in files:
                listed = owned_path(Path(directory) / file, stat.S_ISREG, readonly=True)
                require(listed.st_nlink == 1, 'The staged release contains a linked file.')
        return identity(info), None

    expected = receipt.get('stagedTree')
    require(isinstance(expected, dict) and set(expected) == {'version', 'sha256', 'files', 'directories', 'bytes'}
            and type(expected['version']) is int and expected['version'] == 1
            and all(type(expected[key]) is int and expected[key] >= 0 for key in ('files', 'directories', 'bytes'))
            and isinstance(expected['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', expected['sha256']),
            'The staged release requires a complete tree receipt. Stage the signed archive with the current tool.')
    if recovery_journal is not None:
        recorded = recovery_journal.get('stagedTree')
        require(isinstance(recorded, dict) and recorded == expected
                and all(type(recorded[key]) is type(value) for key, value in expected.items()),
                'The staged tree receipt differs from the activation journal.')
    require(staged_tree(staged, 0, RECEIPT) == expected, 'The staged release tree changed after staging.')
    return identity(info), expected


def check_candidate_startup(staged, env):
    entry = staged / 'scripts/start-team-service.mjs'
    owned_path(entry, stat.S_ISREG, readonly=True)
    # Bound the candidate process under the service account as well as the parent command.
    try:
        result = run([RUNUSER, '-u', 'shenyi-team', '-g', 'shenyi-team', '--', TIMEOUT, '--kill-after=2s', '30s',
                      NODE, entry, '--check-startup', '--config', CONFIG], 40, env)
        if result.returncode == 0 and json.loads(result.stdout) == {'event': 'startup-ready'}:
            return
    except (ValueError, OSError, subprocess.TimeoutExpired):
        pass
    raise ValueError('The candidate startup preflight failed before stopping the current service.')


def activation_paths(revision, change_id):
    suffix = revision
    if change_id is not None:
        require(isinstance(change_id, str) and re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?', change_id),
                'Use a change ID of 1 to 32 lowercase letters, digits or internal hyphens.')
        suffix = f'{revision}-{change_id}'
    return ROOT / f'previous-{suffix}', ROOT / f'failed-{suffix}', ROOT / f'activation-{suffix}.json'


def activate(args, root_fd, env):
    revision = args.revision
    change_id = getattr(args, 'change_id', None)
    staged = ROOT / f'staged-{revision}'
    previous, failed, history = activation_paths(revision, change_id)
    require(all(not os.path.lexists(path) for path in (JOURNAL, previous, failed, history)),
            'An activation record, retained directory or unfinished change already exists.')
    root_device = os.fstat(root_fd).st_dev
    prior = owned_path(CURRENT, stat.S_ISDIR, readonly=True)
    require(prior.st_dev == root_device, 'The active release must be on the release filesystem.')
    old_identity = identity(prior)
    new_identity, tree = validate_stage(staged, revision, args.archive_sha256, root_device)
    rename = rename_operation()
    stamp = configuration_stamp()
    startup_inputs = startup_input_stamp()
    owned_path(CURRENT / 'scripts/check-team-service.mjs', stat.S_ISREG, readonly=True)
    _, warnings, baseline = health_check(env, prior_warnings=None, limit=15)
    check_candidate_startup(staged, env)
    confirmed = validate_stage(staged, revision, args.archive_sha256, root_device)
    require(configuration_stamp() == stamp and startup_input_stamp() == startup_inputs and process_status(env) == baseline
            and confirmed == (new_identity, tree),
            'Configuration or release state changed during the candidate startup preflight.')
    report = {'revision': revision, 'archiveSha256': args.archive_sha256, 'oldDirectoryIdentity': old_identity,
              'newDirectoryIdentity': new_identity, 'stagedTree': tree,
              'baselinePid': baseline[0], 'baselineInvocation': baseline[1],
              'baselineWarningChecks': sorted(warnings), 'candidateDatabasePreflight': 'passed',
              'candidateStartupPreflight': 'passed', **stamp}
    if change_id is not None:
        report['changeId'] = change_id
    record(JOURNAL, {**report, 'status': 'stopping-current'}, root_fd)

    try:
        stop_service(env)
        require(configuration_stamp() == stamp, 'Configuration or SQLite file identity changed during the window.')
        record(JOURNAL, {**report, 'status': 'exchanging-directories'}, root_fd)
        rename_entry(rename, root_fd, CURRENT, staged, flags=2)  # RENAME_EXCHANGE
    except (ValueError, OSError, subprocess.TimeoutExpired):
        if (identity(CURRENT.stat()) == old_identity and identity(staged.stat()) == new_identity
                and configuration_stamp() == stamp and stopped(service_status(env))):
            restart_previous(env)
            health_check(env, prior_warnings=warnings, limit=55)
        raise

    try:
        os.fsync(root_fd)
        record(JOURNAL, {**report, 'status': 'starting-candidate'}, root_fd)
        service(['start'], env, timeout=45)
        # Use the previous trusted release's check even while the new version is running.
        health, _, active = health_check(env, prior_warnings=warnings, limit=55, probe_root=staged)
        require(configuration_stamp() == stamp and active[1] != baseline[1],
                'The new invocation or unchanged data path could not be verified.')
    except (ValueError, OSError, subprocess.TimeoutExpired) as cause:
        report['candidateFailure'] = str(cause)
        try:
            record(JOURNAL, {**report, 'status': 'restoring-current'}, root_fd)
        except OSError:
            # The pre-exchange record already identifies both directories.
            pass
        stop_service(env)
        require(configuration_stamp() == stamp and identity(CURRENT.stat()) == new_identity
                and identity(staged.stat()) == old_identity, 'Deployment state changed. Review the retained directories.')
        rename_entry(rename, root_fd, CURRENT, staged, flags=2)
        os.fsync(root_fd)
        report['rollbackResetState'] = restart_previous(env)
        health, _, active = health_check(env, prior_warnings=warnings, limit=55)
        require(configuration_stamp() == stamp and active[1] != baseline[1],
                'The restored invocation or unchanged data path could not be verified.')
        rename_entry(rename, root_fd, staged, failed, flags=1)  # RENAME_NOREPLACE
        status, retained = 'rolled-back', failed
    else:
        rename_entry(rename, root_fd, staged, previous, flags=1)
        status, retained = 'activated', previous

    result = {**report, 'status': status, 'currentPid': active[0], 'currentInvocation': active[1],
              'retainedDirectory': str(retained), 'health': health}
    record(JOURNAL, result, root_fd)
    rename_entry(rename, root_fd, JOURNAL, history, flags=1)
    os.fsync(root_fd)
    return result


def read_recovery_journal(args, root_device, change_id):
    info = owned_path(JOURNAL, stat.S_ISREG)
    require(info.st_nlink == 1 and info.st_dev == root_device, 'Untrusted activation journal file.')
    report = json.loads(read_file(JOURNAL, 64 * 1024))
    require(report['revision'] == args.revision and report['archiveSha256'] == args.archive_sha256
            and ('changeId' in report) == (change_id is not None) and report.get('changeId') == change_id
            and report['status'] in RECOVERY_LAYOUTS and report['candidateDatabasePreflight'] == 'passed'
            and report.get('candidateStartupPreflight', 'passed') == 'passed',
            'The journal does not match the approved interrupted activation.')
    for key in ('oldDirectoryIdentity', 'newDirectoryIdentity', 'databaseIdentity'):
        value = report[key]
        require(type(value) is list and len(value) == 2 and all(type(number) is int for number in value)
                and value[0] >= 0 and value[1] > 0, f'Invalid journal identity: {key}.')
    old, new = report['oldDirectoryIdentity'], report['newDirectoryIdentity']
    require(old != new and old[0] == new[0] == root_device
            and re.fullmatch(r'[0-9a-f]{64}', report['configSha256'])
            and type(report['baselinePid']) is int and report['baselinePid'] > 0
            and re.fullmatch(r'[0-9a-f]{32}', report['baselineInvocation']), 'Invalid baseline activation record.')
    warnings = report['baselineWarningChecks']
    require(type(warnings) is list and set(warnings) <= ADVISORY_KEYS and len(set(warnings)) == len(warnings),
            'Invalid activation journal readiness warnings.')
    if report['status'] in {'recovering-current', 'recovered'}:
        require(report.get('recoveredFrom') in RECOVERY_LAYOUTS.keys() - TERMINAL_STATES - {'recovering-current'},
                'Invalid original activation phase.')
    return report


def recovery_layout(directories, report):
    existing = [(kind, path, identity(owned_path(path, stat.S_ISDIR, readonly=True)))
                for kind, path in directories.items() if os.path.lexists(path)]
    require(len(existing) == 2 and existing[0][0] == 'current',
            'Unexpected activation directories. Preserve all release paths for review.')
    _, _, current = existing[0]
    kind, retained, other = existing[1]
    old, new = report['oldDirectoryIdentity'], report['newDirectoryIdentity']
    require((current, other) in ((old, new), (new, old))
            and (current == old, kind) in RECOVERY_LAYOUTS[report['status']],
            'Release directory identities or placement do not match the journal.')
    return current == old, retained


def stable_invocation(env):
    status = service_status(env)
    if stopped(status):
        return None
    require(status.get('ActiveState') == 'active' and status.get('ControlPID') == '0'
            and status.get('Job', '') in {'', '0', '/'},
            'A systemd operation is still in progress. Retry once the unit settles.')
    active = process_status(env)
    require(active == (int(status['MainPID']), status['InvocationID']),
            'The running invocation changed during recovery preflight.')
    return active


def recover(args, root_fd, env):
    root_device = os.fstat(root_fd).st_dev
    change_id = getattr(args, 'change_id', None)
    previous, failed, history = activation_paths(args.revision, change_id)
    report = read_recovery_journal(args, root_device, change_id)
    phase = report['status']
    staged = ROOT / f'staged-{args.revision}'
    require(not os.path.lexists(history), 'An activation history file already exists. Preserve the journal for review.')
    directories = {'current': CURRENT, 'staged': staged, 'previous': previous, 'failed': failed}
    stamp = {key: report[key] for key in ('configSha256', 'databaseIdentity')}

    def check_state(expected=None):
        require(configuration_stamp() == stamp, 'Configuration or SQLite file identity changed since activation.')
        layout = recovery_layout(directories, report)
        require(expected is None or layout == expected, 'Release placement changed during recovery.')
        return layout

    old_current, retained = check_state()
    old_path = CURRENT if old_current else retained
    candidate = retained if old_current else CURRENT
    owned_path(old_path / 'scripts/check-team-service.mjs', stat.S_ISREG, readonly=True)
    owned_path(old_path / 'scripts/start-team-service.mjs', stat.S_ISREG, readonly=True)
    candidate_identity, _ = validate_stage(candidate, args.revision, args.archive_sha256, root_device,
                                           receipt_stage=staged, recovery_journal=report)
    require(candidate_identity == report['newDirectoryIdentity'],
            'The candidate directory changed during recovery preflight.')
    active_before = stable_invocation(env)
    check_state((old_current, retained))
    warnings = set(report['baselineWarningChecks'])
    rename = rename_operation()

    if phase in TERMINAL_STATES:
        require(report.get('retainedDirectory') == str(retained) and active_before is not None,
                'The recorded outcome cannot be reconciled with the retained and running release.')
        _, _, active = health_check(env, prior_warnings=warnings, limit=55, probe_root=old_path)
        require(active == active_before == stable_invocation(env),
                'The completed activation invocation changed during verification.')
        check_state((old_current, retained))
        # Keep the historical receipt intact even if a later restart changed the invocation.
        result = report
    else:
        report.setdefault('recoveredFrom', phase)
        report['status'] = 'recovering-current'
        record(JOURNAL, report, root_fd)
        if not old_current:
            if active_before is not None:
                stop_service(env)
            require(stable_invocation(env) is None, 'The candidate must be stopped before restoring the prior release.')
            check_state((False, retained))
            rename_entry(rename, root_fd, CURRENT, retained, flags=2)
            os.fsync(root_fd)
        check_state((True, retained))
        restored = stable_invocation(env)
        if restored is None:
            report['recoveryResetState'] = restart_previous(env)
        health, _, active = health_check(env, prior_warnings=warnings, limit=55)
        require(restored is None or active == restored, 'The previous release invocation changed during verification.')
        check_state((True, retained))
        if retained != failed:
            rename_entry(rename, root_fd, retained, failed, flags=1)
            os.fsync(root_fd)
        retained = failed
        report['status'] = 'recovered'
        require(stable_invocation(env) == active, 'The release invocation changed before archiving the recovery result.')
        check_state((True, retained))
        result = {**report, 'currentPid': active[0], 'currentInvocation': active[1],
                  'retainedDirectory': str(retained), 'health': health}
        record(JOURNAL, result, root_fd)

    rename_entry(rename, root_fd, JOURNAL, history, flags=1)
    os.fsync(root_fd)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--same-schema', action='store_true', required=True)
    parser.add_argument('--edge-ca', type=Path)
    parser.add_argument('--change-id', help='Use an independent deployment record for this change.')
    parser.add_argument('--recover', action='store_true', help='Recover or reconcile a journaled activation.')
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0 and re.fullmatch(r'[0-9a-f]{40}', args.revision)
                and re.fullmatch(r'[0-9a-f]{64}', args.archive_sha256),
                'Run as the release administrator with the approved revision and SHA-256.')
        for directory in (ROOT, *ROOT.parents, NODE.parent, NODE.parent.parent):
            owned_path(directory, stat.S_ISDIR)
        for path in (NODE, CONFIG, BACKEND_CA, Path(UNIT_PATH), RUNUSER, TIMEOUT):
            owned_path(path, stat.S_ISREG)
        env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
        if args.edge_ca:
            require(args.edge_ca.is_absolute(), 'Use an absolute trusted edge CA path.')
            owned_path(args.edge_ca, stat.S_ISREG)
            env['NODE_EXTRA_CA_CERTS'] = str(args.edge_ca)
        root_fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(root_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            operation = recover if args.recover else activate
            result = operation(args, root_fd, env)
        finally:
            os.close(root_fd)
        print(json.dumps(result))
        return 0 if args.recover or result['status'] == 'activated' else 2
    except (ValueError, OSError, AttributeError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'failed', 'message': str(error)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
