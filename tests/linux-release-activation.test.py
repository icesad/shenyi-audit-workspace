"""Portable state-machine tests for Linux release activation and recovery."""

from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


if os.name == 'nt':
    # The test calls the recovery worker directly under a private fixture.
    sys.modules.setdefault('fcntl', ModuleType('fcntl'))
sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/activate-linux-release.py'
REVISION = 'a' * 40
ARCHIVE_SHA = 'b' * 64
CHANGE_ID = 'rollback-' + 'a' * 23
BASELINE_INVOCATION = '1' * 32
OTHER_INVOCATION = '2' * 32
RESTORED_INVOCATION = '3' * 32
PHASES = (
    ('stopping-current', 'old', 'staged', 'active', []),
    ('exchanging-directories', 'old', 'staged', 'inactive', ['start']),
    ('exchanging-directories', 'new', 'staged', 'inactive', ['exchange', 'start']),
    ('starting-candidate', 'new', 'staged', 'active', ['stop', 'exchange', 'start']),
    ('starting-candidate', 'new', 'previous', 'active', ['stop', 'exchange', 'start']),
    ('restoring-current', 'new', 'staged', 'active', ['stop', 'exchange', 'start']),
    ('restoring-current', 'old', 'staged', 'active', []),
    ('restoring-current', 'old', 'failed', 'active', []),
    ('recovering-current', 'old', 'previous', 'inactive', ['start']),
)


def write_json(path, value):
    path.write_text(json.dumps(value) + '\n', encoding='utf-8')


def fixture_tree(root, _owner_uid, receipt_name):
    # Exercise the worker's comparison against a path-independent seal on Windows.
    # Native deployment tests exercise the production Linux inventory and permissions.
    directories = sorted(path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_dir())
    files = {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob('*')
             if path.is_file() and path != root / receipt_name}
    representation = [directories, [(name, data.hex()) for name, data in sorted(files.items())]]
    return {'version': 1, 'sha256': hashlib.sha256(json.dumps(representation).encode()).hexdigest(),
            'files': len(files), 'directories': len(directories), 'bytes': sum(map(len, files.values()))}


class Deployment:
    def __init__(self, directory, phase, mounted, retention, state, *, change_id=None):
        spec = importlib.util.spec_from_file_location('activation', SCRIPT)
        self.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.release)
        release = self.release
        release.ROOT = directory / 'release'
        release.ROOT.mkdir()
        release.CURRENT = release.ROOT / 'current'
        release.JOURNAL = release.ROOT / '.shenyi-activation.json'
        release.CONFIG = directory / 'service.json'
        release.BACKEND_CA = directory / 'backend-ca.pem'
        release.BACKEND_CA.write_bytes(b'synthetic backend trust anchor\n')
        release.owned_path = self.owned_fixture_path
        release.staged_tree = fixture_tree
        self.database = directory / 'team.sqlite'
        with closing(sqlite3.connect(self.database)) as db:
            db.execute('CREATE TABLE team_profile (label TEXT NOT NULL)')
            db.execute('INSERT INTO team_profile VALUES (?)', ('synthetic owner',))
            db.commit()
        self.database_bytes = self.database.read_bytes()
        write_json(release.CONFIG, {'database': str(self.database)})
        self.current = release.CURRENT
        self.journal = release.JOURNAL
        suffix = REVISION if change_id is None else f'{REVISION}-{change_id}'
        self.history = release.ROOT / f'activation-{suffix}.json'
        self.staged = release.ROOT / f'staged-{REVISION}'
        self.previous = release.ROOT / f'previous-{suffix}'
        self.failed = release.ROOT / f'failed-{suffix}'
        retained = getattr(self, retention)
        self.old = self.current if mounted == 'old' else retained
        self.new = self.current if mounted == 'new' else retained
        for item in (self.old, self.new):
            scripts = item / 'scripts'
            scripts.mkdir(parents=True)
            for fname in ('start-team-service.mjs', 'check-team-service.mjs'):
                file = scripts / fname
                file.write_text('/* synthetic fixture */\n', encoding='utf-8')
                file.chmod(0o444)
            scripts.chmod(0o555)
        lock = self.new / 'package-lock.json'
        lock.write_text('{}\n', encoding='utf-8')
        lock.chmod(0o444)
        self.dependency = self.new / 'node_modules' / 'synthetic-package' / 'index.mjs'
        self.dependency.parent.mkdir(parents=True)
        self.dependency.write_bytes(b'/* synthetic dependency */\n')
        self.dependency.chmod(0o444)
        self.dependency.parent.chmod(0o555)
        self.dependency.parent.parent.chmod(0o555)
        self.receipt_path = self.new / '.shenyi-stage-receipt.json'
        write_json(self.receipt_path, {
            'ok': True, 'offline': True, 'stageDir': str(self.staged),
            'archive': {'revision': REVISION, 'sha256': ARCHIVE_SHA},
            'packageLockSha256': hashlib.sha256(lock.read_bytes()).hexdigest(),
        })
        self.receipt_path.chmod(0o444)
        for item in (self.old, self.new):
            item.chmod(0o555)
        self.old_id = self.identity(self.old)
        self.new_id = self.identity(self.new)
        self.state = state
        self.pid = 101 if mounted == 'old' and phase == 'stopping-current' else 202
        self.invocation = BASELINE_INVOCATION if self.pid == 101 else OTHER_INVOCATION
        self.live_directory = self.identity(self.current)
        self.control_pid = '0'
        self.job = '0'
        self.actions = []
        self.probes = []
        self.candidate_preflights = []
        self.candidate_commands = []
        self.candidate_exit = 0
        self.candidate_stdout = '{"event":"startup-ready"}\n'
        self.backend_tls_checks = []
        self.backend_tls_error = None
        self.cut_after_exchange = False
        self.cut_after_retention = False
        self.report = {
            'revision': REVISION, 'archiveSha256': ARCHIVE_SHA,
            'oldDirectoryIdentity': self.old_id, 'newDirectoryIdentity': self.new_id,
            'baselinePid': 101, 'baselineInvocation': BASELINE_INVOCATION,
            'baselineWarningChecks': [], 'candidateDatabasePreflight': 'passed',
            **release.configuration_stamp(), 'status': phase,
        }
        if change_id is not None:
            self.report['changeId'] = change_id
        if phase in ('activated', 'rolled-back', 'recovered'):
            self.report.update(currentPid=self.pid, currentInvocation=self.invocation,
                               retainedDirectory=str(retained), health=self.health_report())
        if phase in ('recovering-current', 'recovered'):
            self.report['recoveredFrom'] = 'restoring-current'
        write_json(self.journal, self.report)
        release.rename_operation = lambda: object()
        release.rename_entry = self.rename_entry
        release.service_status = self.service_status
        release.process_status = self.process_status
        self.check_candidate_startup_impl = release.check_candidate_startup
        release.check_candidate_startup = self.check_candidate_startup
        self.backend_tls_impl = release.assert_backend_tls_unchanged
        release.assert_backend_tls_unchanged = self.assert_backend_tls_unchanged
        release.run = self.run_candidate
        release.service = self.service
        release.stop_service = self.stop_service
        release.restart_previous = self.restart_previous
        release.health_check = self.health_check
        self.fd_path = directory / 'fixture-filesystem'

    @staticmethod
    def owned_fixture_path(path, kind, readonly=False):
        # A developer need not be root. Keep real canonical/type/inode checks and
        # translate from the readonly flag on Windows to the fixture permissions.
        info = path.lstat()
        mask = 0o222 if readonly else (0 if os.name == 'nt' else 0o022)
        if path.resolve(strict=True) != path or not kind(info.st_mode) or info.st_mode & mask:
            raise ValueError(f'Untrusted fixture path: {path}')
        return info

    def identity(self, path):
        return self.release.identity(path.stat())

    def service_status(self, env):
        return {'ActiveState': self.state, 'MainPID': str(self.pid if self.state == 'active' else 0),
                'InvocationID': self.invocation, 'ControlPID': self.control_pid, 'Job': self.job}

    def process_status(self, env):
        if self.state != 'active' or self.live_directory != self.identity(self.current):
            raise ValueError('Unexpected fixture process identity')
        return self.pid, self.invocation

    def stop_service(self, env):
        self.actions.append('stop')
        self.state = 'inactive'

    def check_candidate_startup(self, staged, env):
        self.candidate_preflights.append(self.identity(staged))
        self.check_candidate_startup_impl(staged, env)

    def run_candidate(self, command, timeout, env):
        self.candidate_commands.append((command, timeout, env))
        return subprocess.CompletedProcess(command, self.candidate_exit, self.candidate_stdout)

    def assert_backend_tls_unchanged(self, env):
        self.backend_tls_checks.append({
            'invocation': self.process_status(env), 'startupChecksCompleted': len(self.candidate_commands),
            'journalExists': self.journal.exists(), 'actions': list(self.actions),
        })
        if self.backend_tls_error is not None:
            raise self.backend_tls_error

    def service(self, args, env, timeout):
        if args != ['start'] or self.identity(self.current) != self.new_id:
            raise AssertionError('Activation must start the candidate after placing it at current')
        self.actions.append('start')
        self.state, self.pid, self.invocation = 'active', 202, OTHER_INVOCATION
        self.live_directory = self.identity(self.current)

    def restart_previous(self, env):
        if self.identity(self.current) != self.old_id:
            raise AssertionError('Recovery attempted to start the candidate as the restored release')
        self.actions.append('start')
        self.state, self.pid, self.invocation = 'active', 303, RESTORED_INVOCATION
        self.live_directory = self.identity(self.current)
        return 'cleared'

    def health_report(self):
        return {'status': 'healthy', 'checks': {key: {'status': 'pass'} for key in self.release.HEALTH_KEYS}}

    def health_check(self, env, prior_warnings, limit, probe_root=None):
        probe = self.current if probe_root is None else probe_root
        self.probes.append(probe)
        if self.identity(probe) != self.old_id:
            raise AssertionError('The trusted probe must run from the previously healthy release')
        return self.health_report(), set(), self.process_status(env)

    def rename_entry(self, rename, root_fd, source, target, flags):
        if source.parent != self.release.ROOT or target.parent != self.release.ROOT:
            raise AssertionError('Rename escaped the private release directory')
        if flags == 2:
            self.actions.append('exchange')
            scratch = self.release.ROOT / '.fixture-exchange'
            source.rename(scratch)
            target.rename(source)
            scratch.rename(target)
            if self.cut_after_exchange:
                self.cut_after_exchange = False
                raise OSError('Synthetic interruption after directory exchange')
        elif flags == 1:
            self.actions.append('record' if source == self.journal else 'retain')
            if target.exists():
                raise FileExistsError(target)
            source.rename(target)
            if target == self.failed and self.cut_after_retention:
                self.cut_after_retention = False
                raise OSError('Synthetic interruption after retaining the candidate')
        else:
            raise AssertionError(f'Unexpected rename flags {flags}')

    def recover(self, revision=REVISION, archive_sha=ARCHIVE_SHA, *, change_id=None):
        args = SimpleNamespace(revision=revision, archive_sha256=archive_sha, recover=True, same_schema=True)
        if change_id is not None:
            args.change_id = change_id
        # Windows cannot open a directory FD. A close-by file gives the real volume
        # ID and accepts fsync while native tests exercise actual directory fsync.
        with self.fd_path.open('w+b') as fixture_fd:
            return self.release.recover(args, fixture_fd.fileno(), {})

    def seal_candidate(self, *, journal):
        receipt = json.loads(self.receipt_path.read_text(encoding='utf-8'))
        seal = fixture_tree(self.new, 0, self.receipt_path.name)
        receipt['stagedTree'] = seal
        self.receipt_path.chmod(0o644)
        write_json(self.receipt_path, receipt)
        self.receipt_path.chmod(0o444)
        if journal:
            self.report['stagedTree'] = seal
            write_json(self.journal, self.report)
        return seal

    def activate(self, *, change_id=None):
        args = SimpleNamespace(revision=REVISION, archive_sha256=ARCHIVE_SHA, recover=False, same_schema=True)
        if change_id is not None:
            args.change_id = change_id
        with self.fd_path.open('w+b') as fixture_fd:
            return self.release.activate(args, fixture_fd.fileno(), {})


class RecoveryTests(unittest.TestCase):
    def deployment(self, phase, mounted, retention, state, *, change_id=None):
        directory = tempfile.TemporaryDirectory(prefix='shenyi-release-test-')
        self.addCleanup(directory.cleanup)
        return Deployment(Path(directory.name).resolve(), phase, mounted, retention, state, change_id=change_id)

    def verify_finish(self, deployment, result, status, live, retained):
        self.assertEqual(result['status'], status)
        self.assertEqual(deployment.identity(deployment.current), live)
        self.assertEqual(deployment.identity(retained), deployment.old_id if live == deployment.new_id else deployment.new_id)
        self.assertEqual(json.loads(deployment.history.read_text(encoding='utf-8')), result)
        self.assertFalse(deployment.journal.exists())
        self.assertEqual(deployment.state, 'active')
        self.assertEqual(deployment.database.read_bytes(), deployment.database_bytes)

    def test_nonterminal_cut_points_restore_the_old_release(self):
        for phase, mounted, retention, state, actions in PHASES:
            with self.subTest(phase=phase, mounted=mounted, retention=retention, state=state):
                f = self.deployment(phase, mounted, retention, state)
                original_invocation = f.invocation
                result = f.recover()
                self.verify_finish(f, result, 'recovered', f.old_id, f.failed)
                self.assertEqual(f.actions, actions + ([] if retention == 'failed' else ['retain']) + ['record'])
                self.assertEqual(f.invocation, RESTORED_INVOCATION if 'start' in actions else original_invocation)
                self.assertEqual(f.probes, [f.current])

    def test_interrupted_recovery_can_resume_after_an_exchange(self):
        f = self.deployment('starting-candidate', 'new', 'previous', 'active')
        f.cut_after_exchange = True
        with self.assertRaisesRegex(OSError, 'Synthetic interruption'):
            f.recover()
        self.assertEqual(f.identity(f.current), f.old_id)
        self.assertEqual(f.identity(f.previous), f.new_id)
        self.assertTrue(f.journal.is_file())
        self.assertFalse(f.history.exists())
        result = f.recover()
        self.verify_finish(f, result, 'recovered', f.old_id, f.failed)
        self.assertEqual(f.actions, ['stop', 'exchange', 'start', 'retain', 'record'])

    def test_interrupted_candidate_retention_does_not_restart_the_restored_release(self):
        f = self.deployment('exchanging-directories', 'new', 'staged', 'inactive')
        f.cut_after_retention = True
        with self.assertRaisesRegex(OSError, 'after retaining'):
            f.recover()
        self.assertEqual(f.identity(f.current), f.old_id)
        self.assertEqual(f.identity(f.failed), f.new_id)
        self.assertFalse(f.history.exists())
        result = f.recover()
        self.verify_finish(f, result, 'recovered', f.old_id, f.failed)
        self.assertEqual(f.actions, ['exchange', 'start', 'retain', 'record'])
        self.assertEqual(f.invocation, RESTORED_INVOCATION)

    def test_durable_completion_is_verified_and_archived_without_restarting(self):
        for status, mounted, retention in (('activated', 'new', 'previous'), ('rolled-back', 'old', 'failed'),
                                           ('recovered', 'old', 'failed')):
            with self.subTest(status=status):
                f = self.deployment(status, mounted, retention, 'active')
                live = f.identity(f.current)
                original_receipt = f.journal.read_bytes()
                f.pid, f.invocation = 404, RESTORED_INVOCATION
                result = f.recover()
                self.verify_finish(f, result, status, live, getattr(f, retention))
                self.assertEqual(f.actions, ['record'])
                self.assertEqual(f.invocation, RESTORED_INVOCATION)
                self.assertEqual(original_receipt, f.history.read_bytes())
                self.assertEqual(f.probes, [f.previous if mounted == 'new' else f.current])

    def assert_refused(self, deployment, **approval):
        before = deployment.journal.read_bytes()
        history = deployment.history.read_bytes() if deployment.history.exists() else None
        release_paths = (deployment.current, deployment.staged, deployment.previous, deployment.failed)
        recorded = {path: deployment.identity(path) for path in release_paths if path.exists()}
        with self.assertRaises((OSError, ValueError)):
            deployment.recover(**approval)
        self.assertEqual(deployment.actions, [])
        if history is None:
            self.assertFalse(deployment.history.exists())
        else:
            self.assertEqual(deployment.history.read_bytes(), history)
        self.assertEqual(deployment.journal.read_bytes(), before)
        self.assertEqual({path: deployment.identity(path) for path in release_paths if path.exists()}, recorded)

    def test_wrong_approval_and_changed_metadata_cannot_mutate_release_or_service(self):
        common = ('starting-candidate', 'new', 'staged', 'active')
        f = self.deployment(*common)
        self.assert_refused(f, archive_sha='c' * 64)
        self.assert_refused(f, revision='d' * 40)
        f.release.CONFIG.write_bytes(f.release.CONFIG.read_bytes() + b'\n')
        self.assert_refused(f)

        f = self.deployment(*common)
        f.database.rename(f.database.with_suffix('.retained'))
        f.database.write_bytes(f.database_bytes)
        self.assert_refused(f)

        f = self.deployment(*common)
        f.receipt_path.chmod(0o644)
        receipt = json.loads(f.receipt_path.read_text(encoding='utf-8'))
        receipt['archive']['sha256'] = 'e' * 64
        write_json(f.receipt_path, receipt)
        f.receipt_path.chmod(0o444)
        self.assert_refused(f)

        f = self.deployment(*common)
        f.failed.mkdir()
        f.failed.chmod(0o555)
        self.assert_refused(f)

        f = self.deployment(*common)
        f.history.write_text('existing record\n', encoding='utf-8')
        self.assert_refused(f)

    def test_inflight_service_and_different_running_release_are_refused(self):
        f = self.deployment('starting-candidate', 'new', 'staged', 'active')
        f.control_pid, f.job = '321', '42'
        self.assert_refused(f)

        f = self.deployment('activated', 'new', 'previous', 'active')
        f.live_directory = f.old_id
        self.assert_refused(f)

    def fresh_deployment(self, *, sealed=True, change_id=None):
        f = self.deployment('stopping-current', 'old', 'staged', 'active', change_id=change_id)
        f.journal.unlink()
        seal = f.seal_candidate(journal=False) if sealed else None
        return f, seal

    def assert_activation_refused(self, deployment, *, preflight_started=False):
        with self.assertRaises((OSError, ValueError)):
            deployment.activate()
        self.assertEqual(deployment.actions, [])
        self.assertEqual(deployment.candidate_preflights, [deployment.new_id] if preflight_started else [])
        self.assertEqual(deployment.probes, [deployment.current] if preflight_started else [])
        self.assertFalse(deployment.journal.exists())
        self.assertFalse(deployment.history.exists())
        self.assertFalse(deployment.previous.exists())
        self.assertFalse(deployment.failed.exists())
        self.assertEqual(deployment.identity(deployment.current), deployment.old_id)
        self.assertEqual(deployment.identity(deployment.staged), deployment.new_id)
        self.assertEqual(deployment.process_status({}), (101, BASELINE_INVOCATION))
        self.assertEqual(deployment.database.read_bytes(), deployment.database_bytes)

    @staticmethod
    def change_same_size(path):
        before = path.read_bytes()
        path.chmod(0o644)
        path.write_bytes(bytes([before[0] ^ 1]) + before[1:])
        path.chmod(0o444)

    def test_activation_binds_the_sealed_tree_in_the_durable_receipt(self):
        f, seal = self.fresh_deployment()
        result = f.activate()
        self.assertNotIn('changeId', result)
        self.verify_finish(f, result, 'activated', f.new_id, f.previous)
        self.assertEqual(result['stagedTree'], seal)
        self.assertEqual(fixture_tree(f.current, 0, f.receipt_path.name), seal)
        self.assertEqual(f.candidate_preflights, [f.new_id])
        release = f.release
        self.assertEqual(f.candidate_commands, [([
            release.RUNUSER, '-u', 'shenyi-team', '-g', 'shenyi-team', '--', release.TIMEOUT, '--kill-after=2s', '30s',
            release.NODE, f.staged / 'scripts/start-team-service.mjs', '--check-startup', '--config', release.CONFIG,
        ], 40, {})])
        self.assertEqual(result['candidateStartupPreflight'], 'passed')
        self.assertEqual(result['candidateDatabasePreflight'], 'passed')
        self.assertEqual(result['backendTlsPreflight'], 'unchanged')
        self.assertEqual(f.backend_tls_checks, [{
            'invocation': (101, BASELINE_INVOCATION), 'startupChecksCompleted': 1,
            'journalExists': False, 'actions': [],
        }])
        self.assertEqual(f.actions, ['stop', 'exchange', 'start', 'retain', 'record'])

    def test_failed_or_invalid_startup_receipt_cannot_stop_the_current_service(self):
        for exit_code, stdout in ((1, ''), (1, '{"event":"startup-ready"}'), (0, '{"event":"database-ready"}'),
                                  (0, '{"event":"startup-ready","extra":true}'), (0, 'unexpected output')):
            with self.subTest(exit_code=exit_code, stdout=stdout):
                f, _ = self.fresh_deployment()
                f.candidate_exit, f.candidate_stdout = exit_code, stdout
                self.assert_activation_refused(f, preflight_started=True)
                self.assertEqual(len(f.candidate_commands), 1)
                self.assertEqual(f.backend_tls_checks, [])

    def test_backend_tls_chain_rejection_preserves_running_release_and_database(self):
        for reason in ('configured and presented chains differ', 'upstream chain is invalid'):
            with self.subTest(reason=reason):
                f, _ = self.fresh_deployment()
                f.backend_tls_error = ValueError(reason)
                before_database = f.release.configuration_stamp()['databaseIdentity']
                self.assert_activation_refused(f, preflight_started=True)
                self.assertEqual(f.backend_tls_checks, [{
                    'invocation': (101, BASELINE_INVOCATION), 'startupChecksCompleted': 1,
                    'journalExists': False, 'actions': [],
                }])
                self.assertEqual(f.release.configuration_stamp()['databaseIdentity'], before_database)

    def test_startup_input_change_during_backend_tls_probe_cannot_stop_the_current_service(self):
        for input_name in ('configured chain', 'Nginx CA'):
            with self.subTest(input=input_name):
                f, _ = self.fresh_deployment()
                certificate = f.release.CONFIG.with_name('backend-chain.pem')
                certificate.write_bytes(b'synthetic preflight chain\n')
                write_json(f.release.CONFIG, {'database': str(f.database), 'tlsCertificate': str(certificate)})
                path_to_change = certificate if input_name == 'configured chain' else f.release.BACKEND_CA
                before = path_to_change.stat()
                stamp = f.release.startup_input_stamp()

                def mutate_during_tls_check(env):
                    f.assert_backend_tls_unchanged(env)
                    self.change_same_size(path_to_change)
                    os.utime(path_to_change, ns=(before.st_atime_ns, before.st_mtime_ns - 1_000_000_000))

                f.release.assert_backend_tls_unchanged = mutate_during_tls_check
                self.assert_activation_refused(f, preflight_started=True)
                self.assertEqual(len(f.backend_tls_checks), 1)
                self.assertNotEqual(f.release.startup_input_stamp(), stamp)

    def test_backend_tls_guard_uses_verified_loopback_and_matches_chain_order(self):
        f, _ = self.fresh_deployment()
        release = f.release
        release.OPENSSL = f.release.CONFIG.with_name('openssl-fixture')
        release.OPENSSL.write_bytes(b'stubbed process, never executed\n')
        certificate = release.CONFIG.with_name('backend-chain.pem')
        # Stub the already-verified subprocess boundary with ordered, distinct
        # certificate byte strings. The Ubuntu rehearsal exercises real X.509.
        leaf = b'-----BEGIN CERTIFICATE-----\nY2VydDE=\n-----END CERTIFICATE-----\n'
        intermediate = b'-----BEGIN CERTIFICATE-----\nY2VydDI=\n-----END CERTIFICATE-----\n'
        certificate.write_bytes(leaf + intermediate)
        env = {'LANG': 'C'}
        common = [release.OPENSSL, 's_client', '-connect', '127.0.0.1:9443', '-showcerts',
                  '-verify_return_error', '-verifyCAfile', release.BACKEND_CA, '-min_protocol', 'TLSv1.2']

        def configure(host):
            write_json(release.CONFIG, {'database': str(f.database), 'apiBase': 'https://' + host,
                                        'listenPort': 9443, 'tlsCertificate': str(certificate)})

        def probe(result, expected_name_check, expected_error=None):
            with patch.object(release.subprocess, 'run', return_value=result) as run:
                if expected_error is None:
                    f.backend_tls_impl(env)
                else:
                    with self.assertRaises(ValueError) as failure:
                        f.backend_tls_impl(env)
                    self.assertEqual(str(failure.exception), expected_error)
                run.assert_called_once_with(common + expected_name_check, stdin=subprocess.DEVNULL,
                                            capture_output=True, timeout=8, env=env)

        dns = 'team.shenyi.example'
        configure(dns)
        dns_check = ['-servername', dns, '-verify_hostname', dns]
        received = b'Certificate chain\n' + (leaf + intermediate).replace(b'\n', b'\r\n')
        probe(subprocess.CompletedProcess([], 0, received, b''), dns_check)
        probe(subprocess.CompletedProcess([], 0, intermediate + leaf, b''), dns_check, release.BACKEND_TLS_MISMATCH)
        probe(subprocess.CompletedProcess([], 1, received, b'synthetic verification fault'), dns_check,
              release.BACKEND_TLS_UNVERIFIED)
        probe(subprocess.CompletedProcess([], 0, leaf + release.BEGIN_CERTIFICATE, b''), dns_check,
              release.BACKEND_TLS_UNVERIFIED)
        configure('127.0.0.1')
        probe(subprocess.CompletedProcess([], 0, received, b''), ['-noservername', '-verify_ip', '127.0.0.1'])

    def test_startup_probe_timeout_cannot_stop_the_current_service(self):
        f, _ = self.fresh_deployment()

        def timeout(command, seconds, env):
            raise subprocess.TimeoutExpired(command, seconds)

        f.release.run = timeout
        self.assert_activation_refused(f, preflight_started=True)

    def test_new_activation_refuses_an_unsealed_stage(self):
        f, _ = self.fresh_deployment(sealed=False)
        self.assert_activation_refused(f)

    def test_activation_refuses_tree_drift_before_any_candidate_execution_or_stop(self):
        for change in ('source', 'dependency', 'add', 'remove'):
            with self.subTest(change=change):
                f, _ = self.fresh_deployment()
                if change == 'source':
                    self.change_same_size(f.new / 'scripts/start-team-service.mjs')
                elif change == 'dependency':
                    self.change_same_size(f.dependency)
                else:
                    directory = f.dependency.parent
                    directory.chmod(0o755)
                    try:
                        if change == 'add':
                            added = directory / 'additional.mjs'
                            added.write_bytes(b'/* fixture */\n')
                            added.chmod(0o444)
                        else:
                            f.dependency.chmod(0o644)
                            f.dependency.unlink()
                    finally:
                        directory.chmod(0o555)
                self.assert_activation_refused(f)

    def test_tree_changes_after_startup_preflight_cannot_stop_the_current_service(self):
        f, _ = self.fresh_deployment()

        def change_after_preflight(staged, env):
            f.check_candidate_startup(staged, env)
            self.change_same_size(f.dependency)

        f.release.check_candidate_startup = change_after_preflight
        self.assert_activation_refused(f, preflight_started=True)

    def test_startup_input_changes_cannot_stop_the_current_service(self):
        for field in ('tlsCertificate', 'tlsKey', 'smsProfile', 'wechatProfile', 'wechatNativeCallbackProfile', 'wechatNativeWebsiteProfile'):
            with self.subTest(field=field):
                f, _ = self.fresh_deployment()
                filename = f.release.CONFIG.with_name(field)
                filename.write_bytes(b'synthetic startup input\n')
                write_json(f.release.CONFIG, {'database': str(f.database), field: str(filename)})
                before = filename.stat()

                def change_after_preflight(staged, env):
                    f.check_candidate_startup(staged, env)
                    self.change_same_size(filename)
                    os.utime(filename, ns=(before.st_atime_ns, before.st_mtime_ns - 1_000_000_000))

                f.release.check_candidate_startup = change_after_preflight
                self.assert_activation_refused(f, preflight_started=True)

    def test_missing_startup_input_is_diagnosed_by_the_candidate(self):
        f, _ = self.fresh_deployment()
        missing_profile = f.release.CONFIG.with_name('missing-wechat.json')
        write_json(f.release.CONFIG, {'database': str(f.database), 'wechatProfile': str(missing_profile)})
        f.candidate_exit, f.candidate_stdout = 1, ''
        self.assert_activation_refused(f, preflight_started=True)
        self.assertFalse(missing_profile.exists())

    def test_recovery_checks_a_seal_after_renaming_and_preserves_it(self):
        f = self.deployment('starting-candidate', 'new', 'previous', 'active')
        f.report['candidateStartupPreflight'] = 'passed'
        seal = f.seal_candidate(journal=True)
        result = f.recover()
        self.verify_finish(f, result, 'recovered', f.old_id, f.failed)
        self.assertEqual(result['stagedTree'], seal)
        self.assertEqual(fixture_tree(f.failed, 0, f.receipt_path.name), seal)
        self.assertEqual(f.actions, ['stop', 'exchange', 'start', 'retain', 'record'])
        self.assertEqual(f.probes, [f.current])
        self.assertEqual(f.candidate_preflights, [])

    def test_recovery_refuses_a_missing_mismatched_or_changed_seal(self):
        for change in ('journal missing', 'receipt missing', 'journal digest', 'journal boolean',
                       'journal float', 'candidate content', 'startup receipt'):
            with self.subTest(change=change):
                f = self.deployment('starting-candidate', 'new', 'previous', 'active')
                f.seal_candidate(journal=change != 'journal missing')
                if change == 'receipt missing':
                    receipt = json.loads(f.receipt_path.read_text(encoding='utf-8'))
                    del receipt['stagedTree']
                    f.receipt_path.chmod(0o644)
                    write_json(f.receipt_path, receipt)
                    f.receipt_path.chmod(0o444)
                elif change == 'journal digest':
                    f.report['stagedTree']['sha256'] = 'd' * 64
                    write_json(f.journal, f.report)
                elif change == 'journal boolean':
                    f.report['stagedTree']['version'] = True
                    write_json(f.journal, f.report)
                elif change == 'journal float':
                    f.report['stagedTree']['files'] = float(f.report['stagedTree']['files'])
                    write_json(f.journal, f.report)
                elif change == 'candidate content':
                    self.change_same_size(f.dependency)
                elif change == 'startup receipt':
                    f.report['candidateStartupPreflight'] = 'failed'
                    write_json(f.journal, f.report)
                self.assert_refused(f)
                self.assertEqual(f.probes, [])


    def test_change_id_allows_existing_history_without_changing_the_signed_stage(self):
        f, seal = self.fresh_deployment(change_id=CHANGE_ID)
        earlier_histories = {
            f.release.ROOT / f'activation-{REVISION}.json': b'{"status":"activated","priorReceipt":true}\n',
            f.release.ROOT / f'activation-{REVISION}-older-change.json': b'{"changeId":"older-change"}\n',
        }
        for path, data in earlier_histories.items():
            path.write_bytes(data)
        legacy_previous = f.release.ROOT / f'previous-{REVISION}'
        legacy_previous.mkdir()
        legacy_identity = f.identity(legacy_previous)
        stage_receipt = f.receipt_path.read_bytes()

        def verify_pending_change(args, env, timeout):
            pending = json.loads(f.journal.read_bytes())
            self.assertEqual(pending['changeId'], CHANGE_ID)
            self.assertEqual(pending['status'], 'starting-candidate')
            f.service(args, env, timeout)

        f.release.service = verify_pending_change
        result = f.activate(change_id=CHANGE_ID)
        self.verify_finish(f, result, 'activated', f.new_id, f.previous)
        self.assertEqual(result['changeId'], CHANGE_ID)
        self.assertEqual(result['stagedTree'], seal)
        self.assertEqual(result['retainedDirectory'], str(f.previous))
        self.assertFalse(f.failed.exists())
        self.assertFalse(f.staged.exists())
        self.assertEqual((f.current / f.receipt_path.name).read_bytes(), stage_receipt)
        for path, data in earlier_histories.items():
            self.assertEqual(path.read_bytes(), data)
        self.assertEqual(f.identity(legacy_previous), legacy_identity)

    def test_same_change_id_conflicts_before_preflight_or_stop(self):
        for existing in ('history', 'previous', 'failed'):
            with self.subTest(existing=existing):
                f, _ = self.fresh_deployment(change_id=CHANGE_ID)
                conflict = getattr(f, existing)
                if existing == 'history':
                    conflict.write_bytes(b'prior change receipt\n')
                else:
                    conflict.mkdir()
                original_identity = f.identity(conflict)
                with self.assertRaises(ValueError):
                    f.activate(change_id=CHANGE_ID)
                self.assertEqual(f.actions, [])
                self.assertEqual(f.probes, [])
                self.assertEqual(f.candidate_preflights, [])
                self.assertEqual(f.identity(conflict), original_identity)
                if existing == 'history':
                    self.assertEqual(conflict.read_bytes(), b'prior change receipt\n')
                self.assertEqual(f.identity(f.current), f.old_id)
                self.assertEqual(f.identity(f.staged), f.new_id)
                self.assertFalse(f.journal.exists())
                self.assertEqual(f.database.read_bytes(), f.database_bytes)

    def test_change_id_rollback_retains_candidate_in_the_scoped_failed_path(self):
        change_id = '7'
        f, _ = self.fresh_deployment(change_id=change_id)

        def startup_failure(args, env, timeout):
            raise ValueError('Synthetic candidate startup refusal')

        f.release.service = startup_failure
        result = f.activate(change_id=change_id)
        self.verify_finish(f, result, 'rolled-back', f.old_id, f.failed)
        self.assertEqual(result['changeId'], change_id)
        self.assertEqual(result['retainedDirectory'], str(f.failed))
        self.assertIn('Synthetic candidate startup refusal', result['candidateFailure'])
        self.assertFalse(f.previous.exists())
        self.assertFalse((f.release.ROOT / f'failed-{REVISION}').exists())

    def test_change_id_rejects_invalid_identifiers_without_mutating_state(self):
        for invalid in ('', 'a' * 33, '-a', 'a-', 'A', 'a_b', 'a/b', '../a', 'a\n', 'a b'):
            with self.subTest(change_id=invalid):
                f, _ = self.fresh_deployment()
                paths = set(f.release.ROOT.iterdir())
                with self.assertRaises(ValueError):
                    f.activate(change_id=invalid)
                self.assertEqual(set(f.release.ROOT.iterdir()), paths)
                self.assertEqual(f.actions, [])
                self.assertEqual(f.candidate_preflights, [])
                self.assertEqual(f.probes, [])
                self.assertEqual(f.identity(f.current), f.old_id)
                self.assertEqual(f.identity(f.staged), f.new_id)

    def test_change_id_recovery_refuses_missing_or_different_id_then_recovers(self):
        f = self.deployment('starting-candidate', 'new', 'previous', 'active', change_id=CHANGE_ID)
        f.report['candidateStartupPreflight'] = 'passed'
        seal = f.seal_candidate(journal=True)
        old_history = f.release.ROOT / f'activation-{REVISION}.json'
        old_history.write_bytes(b'previous completed activation\n')
        before = set(f.release.ROOT.iterdir())
        self.assert_refused(f)
        self.assert_refused(f, change_id='other-change')
        self.assertEqual(set(f.release.ROOT.iterdir()), before)
        self.assertEqual(f.probes, [])
        self.assertEqual(f.process_status({}), (202, OTHER_INVOCATION))

        result = f.recover(change_id=CHANGE_ID)
        self.verify_finish(f, result, 'recovered', f.old_id, f.failed)
        self.assertEqual(result['changeId'], CHANGE_ID)
        self.assertEqual(result['stagedTree'], seal)
        self.assertEqual(result['retainedDirectory'], str(f.failed))
        self.assertEqual(f.actions, ['stop', 'exchange', 'start', 'retain', 'record'])
        self.assertEqual(old_history.read_bytes(), b'previous completed activation\n')

    def test_change_id_terminal_receipt_is_archived_byte_for_byte(self):
        for status, mounted, retention in (('activated', 'new', 'previous'), ('rolled-back', 'old', 'failed')):
            with self.subTest(status=status):
                f = self.deployment(status, mounted, retention, 'active', change_id=CHANGE_ID)
                seal = f.seal_candidate(journal=True)
                original = b'  ' + f.journal.read_bytes() + b'\n'
                f.journal.write_bytes(original)
                previous_invocation = f.invocation
                live = f.identity(f.current)
                result = f.recover(change_id=CHANGE_ID)
                self.verify_finish(f, result, status, live, getattr(f, retention))
                self.assertEqual(result['changeId'], CHANGE_ID)
                self.assertEqual(result['stagedTree'], seal)
                self.assertEqual(f.history.read_bytes(), original)
                self.assertEqual(f.actions, ['record'])
                self.assertEqual(f.invocation, previous_invocation)

    def test_legacy_journal_rejects_a_requested_change_id_and_stays_legacy(self):
        f = self.deployment('stopping-current', 'old', 'staged', 'active')
        self.assert_refused(f, change_id=CHANGE_ID)
        result = f.recover()
        self.verify_finish(f, result, 'recovered', f.old_id, f.failed)
        self.assertNotIn('changeId', result)
        self.assertEqual(f.history.name, f'activation-{REVISION}.json')

    def test_recovery_rejects_an_explicit_null_change_id_in_a_journal(self):
        f = self.deployment('stopping-current', 'old', 'staged', 'active')
        f.report['changeId'] = None
        write_json(f.journal, f.report)
        self.assert_refused(f)
        self.assertEqual(f.probes, [])


if __name__ == '__main__':
    unittest.main()
