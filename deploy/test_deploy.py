import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class RestrictedCommandTests(unittest.TestCase):
    def test_development_accepts_only_valid_digest(self):
        command = 'deploy ' + 'a' * 40 + ' ' + 'b' * 40 + ' sha256:' + 'c' * 64 + ' 123'
        self.assertEqual(deploy.validate_command('development', command)[0], 'deploy')
        with self.assertRaises(ValueError): deploy.validate_command('production', command)

    def test_production_requires_promotion_command(self):
        command = 'promote ' + 'a' * 40 + ' ' + 'b' * 40 + ' 123'
        self.assertEqual(deploy.validate_command('production', command)[0], 'promote')
        with self.assertRaises(ValueError): deploy.validate_command('development', command)

    def test_arbitrary_shell_and_malformed_identifiers_are_rejected(self):
        for command in ['bash', 'cat /etc/passwd', 'deploy x y z 12', 'promote ' + 'a' * 40 + ' ' + 'b' * 40 + ' 123;id']:
            for environment in deploy.ENVIRONMENTS:
                with self.assertRaises(ValueError): deploy.validate_command(environment, command)

if __name__ == '__main__': unittest.main()
