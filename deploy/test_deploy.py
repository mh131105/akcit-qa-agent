import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import json
import tempfile

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

class PromotionTests(unittest.TestCase):
    commit = 'a' * 40
    tree = 'b' * 40

    def github(self, path, _token):
        if path.startswith('/actions/runs/'):
            return {'head_sha': self.commit, 'head_branch': 'main', 'path': '.github/workflows/production.yml', 'event': 'workflow_dispatch', 'status': 'in_progress', 'actor': {'login': 'mh131105'}}
        if path.startswith('/git/commits/'):
            return {'tree': {'sha': self.tree}}
        if path == '/git/ref/heads/main':
            return {'object': {'sha': self.commit}}
        raise AssertionError(path)

    def test_production_refuses_tree_not_validated_in_development(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'development').mkdir()
            (root / 'development' / 'release.json').write_text(json.dumps({'tree': 'c' * 40, 'runtime_smoke': 'passed'}))
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'github', self.github), patch.object(deploy.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'árvore validada'):
                    deploy.execute('production', f'promote {self.commit} {self.tree} 123', 'test-token')
                run.assert_not_called()

    def test_production_refuses_non_owner_even_with_valid_command(self):
        metadata = self.github('/actions/runs/123', None)
        metadata['actor']['login'] = 'another-user'
        with patch.object(deploy, 'github', return_value=metadata), patch.object(deploy.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'responsável'):
                deploy.execute('production', f'promote {self.commit} {self.tree} 123', 'test-token')
            run.assert_not_called()

    def test_finished_or_wrong_workflow_cannot_be_reused(self):
        for change in [{'status': 'completed'}, {'path': '.github/workflows/ci.yml'}, {'event': 'pull_request'}, {'head_branch': 'develop'}]:
            metadata = self.github('/actions/runs/123', None)
            metadata.update(change)
            with patch.object(deploy, 'github', return_value=metadata), patch.object(deploy.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'fluxo autorizado'):
                    deploy.execute('production', f'promote {self.commit} {self.tree} 123', 'test-token')
                run.assert_not_called()

if __name__ == '__main__': unittest.main()
