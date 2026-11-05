"""Exercise recovery refusal paths without touching Docker resources."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('operations', Path(__file__).with_name('operations.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class RecoveryGuards(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.backup = Path(self.temporary.name) / 'backup'
        self.backup.mkdir()
        self.args = SimpleNamespace(project='dicecloud-restore-test', env=Path('/private/runtime.env'), backup=self.backup)
        for name in ops.PAYLOADS:
            (self.backup / name).write_bytes(b'synthetic fixture')
        self.manifest = {
            'format': 2, 'completed_at_utc': '2026-11-05T00:00:00Z',
            'source_project': 'dicecloud-source', 'image_id': 'sha256:retained',
            'database_bytes': 1000, 'files_bytes': 2000,
            'sha256': {name: ops.digest(self.backup / name) for name in ops.PAYLOADS},
        }
        self.save_manifest()

    def save_manifest(self):
        (self.backup / 'manifest.json').write_text(json.dumps(self.manifest))

    def test_refuses_live_or_ambiguous_project_before_docker(self):
        self.args.project = 'dicecloud-live'
        with patch.object(ops, 'run') as docker:
            with self.assertRaisesRegex(RuntimeError, 'fresh disposable'):
                ops.restore(self.args)
            docker.assert_not_called()

    def test_refuses_missing_payload_checksums(self):
        self.manifest['sha256'] = {}
        self.save_manifest()
        with patch.object(ops, 'run') as docker:
            with self.assertRaisesRegex(RuntimeError, 'every required payload'):
                ops.restore(self.args)
            docker.assert_not_called()

    def test_refuses_corrupt_payload_before_docker(self):
        (self.backup / 'files.tar').write_bytes(b'tampered')
        with patch.object(ops, 'run') as docker:
            with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                ops.restore(self.args)
            docker.assert_not_called()

    def test_refuses_incomplete_backup(self):
        del self.manifest['completed_at_utc']
        self.save_manifest()
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            ops.restore(self.args)

    def test_refuses_even_stopped_existing_target_resources(self):
        with patch.object(ops, 'run', return_value=SimpleNamespace(stdout='existing-container')) as docker, patch.object(ops, 'compose') as compose:
            with self.assertRaisesRegex(RuntimeError, 'already has Docker resources'):
                ops.restore(self.args)
            self.assertEqual(docker.call_count, 1)
            compose.assert_not_called()

    def test_refuses_wrong_image_before_starting_restore(self):
        with patch.object(ops, 'run', return_value=SimpleNamespace(stdout='')), patch.object(ops, 'capacity'), patch.object(ops, 'output', return_value=json.dumps({'services': {'app': {'image': 'wrong'}}})), patch.object(ops, 'compose') as compose:
            with self.assertRaisesRegex(RuntimeError, 'image_id'):
                ops.restore(self.args)
            compose.assert_not_called()

    def test_free_space_reserve_is_enforced(self):
        with patch.object(ops.shutil, 'disk_usage', return_value=SimpleNamespace(free=ops.MARGIN - 1)):
            with self.assertRaisesRegex(RuntimeError, '3 GiB reserve'):
                ops.capacity(self.backup)

    def test_interrupted_backup_restarts_app_and_never_marks_complete(self):
        args = SimpleNamespace(project='dicecloud-source', env=self.args.env, destination=Path(self.temporary.name) / 'interrupted')
        calls = []
        def compose(env, project, *command, **kwargs):
            calls.append(command)
            if command[:3] == ('exec', '-T', 'mongo'):
                raise subprocess.CalledProcessError(1, ['mongodump'])
        def output(env, project, *command):
            if command[0] == 'ps': return 'application-container'
            if command[0] == 'exec': return '1024'
            if command[0] == 'run': return '4096 /var/lib/dicecloud'
            return '{}'
        details = [{'State': {'Running': True}, 'Image': 'sha256:retained'}]
        with patch.object(ops, 'run', return_value=SimpleNamespace(stdout=json.dumps(details))), patch.object(ops, 'capacity'), patch.object(ops, 'output', side_effect=output), patch.object(ops, 'compose', side_effect=compose):
            with self.assertRaises(subprocess.CalledProcessError):
                ops.backup(args)
        self.assertEqual(calls[0], ('stop', '-t', '45', 'app'))
        self.assertEqual(calls[-1], ('start', 'app'))
        self.assertFalse((args.destination / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
