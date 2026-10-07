import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('tls_bootstrap', Path(__file__).with_name('tls_bootstrap.py'))
tls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tls)
HEALTHY = {'id': 'a' * 64, 'project': tls.PROJECT, 'service': 'app', 'status': 'running', 'health': 'healthy'}


class TLSBootstrapTests(unittest.TestCase):
    @contextlib.contextmanager
    def environment(self, state=None):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            root = Path(directory)
            (root / 'production').mkdir(mode=0o700)
            state_file = root / 'production/tls-bootstrap.json'
            if state is not None:
                state_file.write_text(json.dumps(state))
            stack.enter_context(patch.object(tls, 'ROOT', root))
            current = stack.enter_context(patch.object(tls, 'container', return_value=HEALTHY))
            dns = stack.enter_context(patch.object(tls, 'dns_ready', return_value=True))
            cert = stack.enter_context(patch.object(tls, 'tls_valid', return_value=False))
            command = stack.enter_context(patch.object(tls.subprocess, 'run'))
            sleep = stack.enter_context(patch.object(tls.time, 'sleep'))
            yield state_file, current, dns, cert, command, sleep

    def test_dns_requires_both_resolvers_exact_ipv4_and_no_ipv6(self):
        good = [{'Status': 0, 'Answer': [{'type': 1, 'data': tls.ADDRESS}]}, {'Status': 0}] * 2
        for bad_index in [None, 0, 2, 3]:
            with self.subTest(bad_index=bad_index):
                answers = list(good)
                if bad_index is not None:
                    answers[bad_index] = ({'Status': 0, 'Answer': [{'type': 28, 'data': '::1'}]}
                                          if bad_index == 3 else {'Status': 3})
                with patch.object(tls.urllib.request, 'urlopen', side_effect=[io.BytesIO(json.dumps(a).encode()) for a in answers]):
                    self.assertEqual(tls.dns_ready(), bad_index is None)

    def test_pending_dns_unhealthy_absent_cooldown_and_done_never_restart(self):
        for scenario in ['dns', 'unhealthy', 'absent', 'cooldown', 'done', 'locked']:
            state = {'done': True} if scenario == 'done' else {'lastAttempt': tls.time.time()} if scenario == 'cooldown' else None
            with self.subTest(scenario=scenario), self.environment(state) as (_, current, dns, _, command, _):
                if scenario == 'dns': dns.return_value = False
                if scenario == 'unhealthy': current.return_value = {**HEALTHY, 'health': 'unhealthy'}
                if scenario == 'absent': current.return_value = None
                with patch.object(tls.fcntl, 'flock', side_effect=BlockingIOError if scenario == 'locked' else None):
                    tls.run()
                command.assert_not_called()

    def test_restart_is_same_container_and_timestamp_is_saved_before_stop(self):
        with self.environment() as (state_file, _, _, cert, command, sleep):
            cert.side_effect = [False, True]
            def observe(arguments, **_):
                if arguments[1] == 'stop':
                    saved = json.loads(state_file.read_text())
                    self.assertEqual(saved['restartContainer'], HEALTHY['id'])
                    self.assertGreater(saved['lastAttempt'], 0)
            command.side_effect = observe
            self.assertEqual(tls.run(), 'complete')
            self.assertEqual([call.args[0] for call in command.call_args_list], [
                ['docker', 'stop', '--time', '30', HEALTHY['id']], ['docker', 'start', HEALTHY['id']]])
            sleep.assert_called_once_with(5)
            self.assertTrue(json.loads(state_file.read_text())['done'])
            self.assertEqual(state_file.stat().st_mode & 0o777, 0o600)

    def test_failure_still_starts_and_interrupted_process_recovers_before_dns(self):
        with self.environment() as (state_file, _, _, _, command, sleep):
            sleep.side_effect = InterruptedError('synthetic interruption')
            with self.assertRaises(InterruptedError): tls.run()
            self.assertEqual(command.call_args.args[0], ['docker', 'start', HEALTHY['id']])
            self.assertNotIn('restartContainer', json.loads(state_file.read_text()))
        with self.environment({'restartContainer': HEALTHY['id'], 'lastAttempt': 1}) as (state_file, current, dns, _, command, _):
            current.return_value = {**HEALTHY, 'status': 'exited'}
            dns.return_value = False
            self.assertEqual(tls.run(), 'recovered')
            dns.assert_not_called()
            command.assert_called_once()
            self.assertNotIn('restartContainer', json.loads(state_file.read_text()))

    def test_existing_valid_certificate_completes_without_restart(self):
        with self.environment() as (state_file, _, _, cert, command, _):
            cert.return_value = True
            self.assertEqual(tls.run(), 'complete')
            self.assertTrue(json.loads(state_file.read_text())['done'])
            command.assert_not_called()

    def test_container_labels_are_verified_and_tls_uses_origin_ip_with_hostname(self):
        with patch.object(tls.subprocess, 'check_output', side_effect=['a' * 12, json.dumps({**HEALTHY, 'project': 'other'})]):
            self.assertIsNone(tls.container())
        with patch.object(tls.socket, 'create_connection') as connection, patch.object(tls.ssl, 'create_default_context') as context:
            self.assertTrue(tls.tls_valid())
            connection.assert_called_once_with((tls.ADDRESS, 443), timeout=8)
            context.return_value.wrap_socket.assert_called_once_with(connection.return_value.__enter__.return_value,
                                                                      server_hostname=tls.HOST)


if __name__ == '__main__': unittest.main()
