"""Portable state-machine tests for the Linux release recovery helper."""

from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest


if os.name == 'nt':
    # The test calls the recovery worker directly under a private fixture.
    sys.modules.setdefault('fcntl', ModuleType('fcntl'))
sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/activate-linux-release.py'
REVISION = 'a' * 40
ARCHIVE_SHA = 'b' * 64
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


class Deployment:
    def __init__(self, directory, phase, mounted, retention, state):
        spec = importlib.util.spec_from_file_location('activation', SCRIPT)
        self.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.release)
        release = self.release
        release.ROOT = directory / 'release'
        release.ROOT.mkdir()
        release.CURRENT = release.ROOT / 'current'
        release.JOURNAL = release.ROOT / '.shenyi-activation.json'
        release.CONFIG = directory / 'service.json'
        release.owned_path = self.owned_fixture_path
        self.database = directory / 'team.sqlite'
        with closing(sqlite3.connect(self.database)) as db:
            db.execute('CREATE TABLE team_profile (label TEXT NOT NULL)')
            db.execute('INSERT INTO team_profile VALUES (?)', ('synthetic owner',))
            db.commit()
        self.database_bytes = self.database.read_bytes()
        write_json(release.CONFIG, {'database': str(self.database)})
        self.current = release.CURRENT
        self.journal = release.JOURNAL
        self.history = release.ROOT / f'activation-{REVISION}.json'
        self.staged = release.ROOT / f'staged-{REVISION}'
        self.previous = release.ROOT / f'previous-{REVISION}'
        self.failed = release.ROOT / f'failed-{REVISION}'
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
        self.cut_after_exchange = False
        self.cut_after_retention = False
        self.report = {
            'revision': REVISION, 'archiveSha256': ARCHIVE_SHA,
            'oldDirectoryIdentity': self.old_id, 'newDirectoryIdentity': self.new_id,
            'baselinePid': 101, 'baselineInvocation': BASELINE_INVOCATION,
            'baselineWarningChecks': [], 'candidateDatabasePreflight': 'passed',
            **release.configuration_stamp(), 'status': phase,
        }
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

    def recover(self, revision=REVISION, archive_sha=ARCHIVE_SHA):
        args = SimpleNamespace(revision=revision, archive_sha256=archive_sha, recover=True, same_schema=True)
        # Windows cannot open a directory FD. A close-by file gives the real volume
        # ID and accepts fsync while native tests exercise actual directory fsync.
        with self.fd_path.open('w+b') as fixture_fd:
            return self.release.recover(args, fixture_fd.fileno(), {})


class RecoveryTests(unittest.TestCase):
    def deployment(self, phase, mounted, retention, state):
        directory = tempfile.TemporaryDirectory(prefix='shenyi-release-test-')
        self.addCleanup(directory.cleanup)
        return Deployment(Path(directory.name).resolve(), phase, mounted, retention, state)

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


if __name__ == '__main__':
    unittest.main()
