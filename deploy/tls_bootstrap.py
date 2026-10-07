#!/usr/bin/env python3
"""Conclui uma única vez o TLS do QAtron quando seu DNS público estiver pronto."""
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
HOST = 'qatron.mhvps.site'
ADDRESS = '76.13.175.64'
PROJECT = 'akcit-qa-prod'
RESOLVERS = ('https://1.1.1.1/dns-query', 'https://8.8.8.8/resolve')
COOLDOWN = 30 * 60


def dns_ready():
    try:
        for resolver in RESOLVERS:
            for record_type in ('A', 'AAAA'):
                request = urllib.request.Request(f'{resolver}?name={HOST}&type={record_type}',
                                                 headers={'Accept': 'application/dns-json'})
                with urllib.request.urlopen(request, timeout=8) as response:
                    answer = json.load(response)
                if answer.get('Status') != 0:
                    return False
                addresses = {item['data'] for item in answer.get('Answer', [])
                             if item.get('type') == (1 if record_type == 'A' else 28)}
                if addresses != ({ADDRESS} if record_type == 'A' else set()):
                    return False
        return True
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def tls_valid():
    try:
        with socket.create_connection((ADDRESS, 443), timeout=8) as connection:
            with ssl.create_default_context().wrap_socket(connection, server_hostname=HOST):
                return True
    except OSError:
        return False


def container():
    ids = subprocess.check_output(['docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={PROJECT}',
                                   '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}}'],
                                  text=True, timeout=15).split()
    if len(ids) != 1:
        return None
    template = ('{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                '"status":{{json .State.Status}},"health":{{json .State.Health.Status}}}')
    value = json.loads(subprocess.check_output(['docker', 'inspect', '--format', template, ids[0]],
                                             text=True, timeout=15))
    if value.get('project') != PROJECT or value.get('service') != 'app':
        return None
    return value


def save_state(state):
    directory = ROOT / 'production'
    with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='.tls-bootstrap-', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())
            temporary.replace(directory / 'tls-bootstrap.json')
            descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)


def start(container_id):
    subprocess.run(['docker', 'start', container_id], check=True, timeout=45,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run():
    directory = ROOT / 'production'
    if not directory.is_dir():
        return 'pending'
    with (ROOT / 'deployment.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'busy'
        state_path = directory / 'tls-bootstrap.json'
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        if not isinstance(state, dict):
            raise ValueError('Estado TLS inválido; intervenção necessária.')
        if state.get('done'):
            return 'done'
        current = container()
        if not current:
            return 'pending'
        pending_restart = state.get('restartContainer')
        if pending_restart:
            # Recuperar apenas o container atual que este procedimento deixou parado.
            # A recuperação precede o DNS: perder conectividade não pode deixá-lo parado.
            if pending_restart == current['id'] and current['status'] == 'exited':
                start(current['id'])
                state.pop('restartContainer')
                save_state(state)
                return 'recovered'
            if pending_restart != current['id'] or current['status'] == 'running':
                state.pop('restartContainer')
                save_state(state)
            else:
                return 'pending'
        if current['status'] != 'running' or current['health'] != 'healthy' or not dns_ready():
            return 'pending'
        if tls_valid():
            save_state({**state, 'done': True})
            return 'complete'
        now = time.time()
        last = state.get('lastAttempt', 0)
        if not isinstance(last, (int, float)) or last < 0:
            raise ValueError('Horário de tentativa TLS inválido; intervenção necessária.')
        if now - last < COOLDOWN:
            return 'cooldown'
        state.update(lastAttempt=now, restartContainer=current['id'])
        save_state(state)  # Persistir o limite e a recuperação antes de parar.
        try:
            subprocess.run(['docker', 'stop', '--time', '30', current['id']], check=True, timeout=45,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(5)  # Maior que o throttle de 2s do provider Docker existente.
        finally:
            start(current['id'])
            state.pop('restartContainer')
            save_state(state)
        if tls_valid():
            save_state({**state, 'done': True})
            return 'complete'
        return 'restarted'


def interrupted(_signal, _frame):
    raise InterruptedError('Bootstrap TLS interrompido.')


if __name__ == '__main__':
    os.umask(0o077)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        outcome = run()
        if outcome in ('complete', 'restarted', 'recovered'):
            print(json.dumps({'event': 'qatron-tls-bootstrap', 'status': outcome}))
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('Bootstrap TLS não concluído; estado preservado para a próxima tentativa.')
