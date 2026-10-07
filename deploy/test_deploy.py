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

class ComposeCommandTests(unittest.TestCase):
    def test_public_route_is_only_applied_to_production(self):
        with patch.object(deploy, 'ROOT', Path('/qa-operations')):
            development = deploy.compose_command('development', Path('/dev.env'))
            production = deploy.compose_command('production', Path('/prod.env'))
        self.assertEqual(development, ['docker', 'compose', '-p', 'akcit-qa-dev',
                         '--env-file', '/dev.env', '-f', '/qa-operations/ops/compose.yml'])
        self.assertEqual(production, ['docker', 'compose', '-p', 'akcit-qa-prod',
                         '--env-file', '/prod.env', '-f', '/qa-operations/ops/compose.yml',
                         '-f', '/qa-operations/ops/compose.production.yml'])

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

    def test_promotion_and_rollback_keep_production_route_and_validated_digest(self):
        for fail_smoke in [False, True]:
            with self.subTest(fail_smoke=fail_smoke), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'development').mkdir()
                (root / 'production').mkdir()
                digest = 'sha256:' + 'c' * 64
                source = 'd' * 40
                (root / 'development/release.json').write_text(json.dumps({
                    'tree': self.tree, 'runtime_smoke': 'passed', 'digest': digest, 'source_commit': source}))
                current = root / 'production/current.env'
                current.write_text('previous-release')
                calls = []

                def command(arguments, **kwargs):
                    calls.append(arguments)
                    if fail_smoke and 'exec' in arguments:
                        raise RuntimeError('synthetic smoke failure')

                def output(arguments, **kwargs):
                    if arguments[:2] == ['docker', 'compose']:
                        self.assertNotIn(str(root / 'ops/compose.production.yml'), arguments)
                        return 'development-container'
                    if arguments[3] == '{{.State.Health.Status}}':
                        return 'healthy'
                    return json.dumps({'io.akcit.git-tree': self.tree, 'org.opencontainers.image.revision': source})

                with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'github', self.github), \
                     patch.object(deploy.subprocess, 'run', command), patch.object(deploy.subprocess, 'check_output', output), \
                     patch('builtins.print'):
                    if fail_smoke:
                        with self.assertRaisesRegex(RuntimeError, 'synthetic smoke failure'):
                            deploy.execute('production', f'promote {self.commit} {self.tree} 123', 'synthetic-token')
                    else:
                        deploy.execute('production', f'promote {self.commit} {self.tree} 123', 'synthetic-token')
                self.assertIn(['docker', 'pull', deploy.IMAGE + '@' + digest], calls)
                compose_calls = [call for call in calls if call[:2] == ['docker', 'compose']]
                self.assertTrue(compose_calls)
                for call in compose_calls:
                    self.assertIn(str(root / 'ops/compose.production.yml'), call)
                if fail_smoke:
                    self.assertIn(str(current), compose_calls[-1])
                    self.assertEqual(current.read_text(), 'previous-release')
                    self.assertFalse((root / 'production/release.json').exists())
                else:
                    release = json.loads((root / 'production/release.json').read_text())
                    self.assertEqual(release['digest'], digest)
                    self.assertEqual(release['source_commit'], source)

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
