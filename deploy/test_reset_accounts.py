import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reset_accounts', Path(__file__).with_name('reset_accounts.py'))
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)


class AccountArchiveTests(unittest.TestCase):
    def test_verified_round_trip_preserves_operational_data_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            data, archive = root / 'active', root / 'private-archive'
            values = {'auth/users.json': b'{"users": [{"id": "old-user"}]}',
                      'runs/old.json': b'{"targetCredential": {"password": "synthetic"}}',
                      'artifacts/old/input.original': b'original\x00bytes',
                      'media/old/screen.png': b'\x89PNG\r\nsynthetic',
                      'pi/auth.json': b'private-operational-fixture', 'runtime-smoke.json': b'{}'}
            for name, value in values.items():
                path = data / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(value)
            with self.assertRaisesRegex(ValueError, 'Pare o serviço'):
                reset.archive_accounts(data, archive)
            self.assertEqual(reset.archive_accounts(data, archive, True), 4)
            for name in reset.ROOTS:
                self.assertFalse((data / name).exists())
            self.assertEqual((data / 'pi/auth.json').read_bytes(), values['pi/auth.json'])
            self.assertEqual(archive.stat().st_mode & 0o777, 0o700)
            self.assertEqual((archive / 'manifest.json').stat().st_mode & 0o777, 0o600)
            reset.restore_accounts(data, archive, True)
            for name, value in values.items():
                self.assertEqual((data / name).read_bytes(), value)
            with self.assertRaises(ValueError):
                reset.restore_accounts(data, archive, True)
            with self.assertRaises(ValueError):
                reset.archive_accounts(data, archive, True)

    def test_unsafe_paths_links_and_failed_verification_keep_originals(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            data = root / 'active'
            (data / 'auth').mkdir(parents=True)
            original = data / 'auth/users.json'
            original.write_bytes(b'legacy-fixture')
            for destination in [data / 'archive', root]:
                with self.assertRaises(ValueError):
                    reset.archive_accounts(data, destination, True)
            (root / 'repo').mkdir(mode=0o700)
            (root / 'repo/.git').write_text('gitdir: synthetic')
            with self.assertRaisesRegex(ValueError, 'Git'):
                reset.archive_accounts(data, root / 'repo/archive', True)
            (root / 'archive-link').symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'Links'):
                reset.archive_accounts(data, root / 'archive-link/archive', True)
            (data / 'auth/link').symlink_to(original)
            with self.assertRaisesRegex(ValueError, 'links'):
                reset.archive_accounts(data, root / 'linked', True)
            (data / 'auth/link').unlink()
            with patch.object(reset, 'read_archive', side_effect=ValueError('verification failure')):
                with self.assertRaisesRegex(ValueError, 'verification'):
                    reset.archive_accounts(data, root / 'failed', True)
            self.assertEqual(original.read_bytes(), b'legacy-fixture')
            reset.archive_accounts(data, root / 'valid', True)
            (root / 'valid/data/auth/users.json').write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'Verificação'):
                reset.restore_accounts(data, root / 'valid', True)
            self.assertFalse((data / 'auth').exists())

    def test_reset_refuses_sqlite_and_archive_parent_visible_to_other_users(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            data = root / 'active'
            (data / 'auth').mkdir(parents=True)
            (data / 'auth/users.json').write_text('{}')
            (data / 'auth/users.sqlite').write_bytes(b'synthetic-sqlite')
            with self.assertRaisesRegex(ValueError, 'legadas'):
                reset.archive_accounts(data, root / 'archive', True)
            (data / 'auth/users.sqlite').unlink()
            (root / 'public').mkdir(mode=0o755)
            with self.assertRaisesRegex(ValueError, '0700'):
                reset.archive_accounts(data, root / 'public/archive', True)


if __name__ == '__main__':
    unittest.main()
