#!/usr/bin/env python3
"""Entrada SSH restrita: duas chaves, dois ambientes, imagem validada em dev."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = 'mh131105/akcit-qa-agent'
IMAGE = 'ghcr.io/' + REPOSITORY
OWNER = REPOSITORY.split('/')[0]
ENVIRONMENTS = {
    'development': {'project': 'akcit-qa-dev', 'port': '3101', 'cpus': '0.75', 'memory': '2g'},
    'production': {'project': 'akcit-qa-prod', 'port': '3102', 'cpus': '1.0', 'memory': '3g'},
}

def validate_command(environment, original):
    parts = shlex.split(original)
    expected = 'deploy' if environment == 'development' else 'promote'
    expected_length = 5 if environment == 'development' else 4
    if len(parts) != expected_length or parts[0] != expected:
        raise ValueError('Comando não autorizado para esta chave.')
    if not all(re.fullmatch(r'[a-f0-9]{40}', value) for value in parts[1:3]):
        raise ValueError('Commit ou árvore Git inválidos.')
    if not re.fullmatch(r'[0-9]{1,20}', parts[-1]):
        raise ValueError('Execução do GitHub inválida.')
    if environment == 'development' and not re.fullmatch(r'sha256:[a-f0-9]{64}', parts[3]):
        raise ValueError('Digest inválido.')
    return parts

def github(path, token):
    req = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'akcit-deployer'})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

def execute(environment, original, token):
    parts = validate_command(environment, original)
    _, commit, tree, *_ = parts
    run = github('/actions/runs/' + parts[-1], token)
    branch = 'develop' if environment == 'development' else 'main'
    workflow = '.github/workflows/' + environment + '.yml'
    event = 'push' if environment == 'development' else 'workflow_dispatch'
    if not (run['head_sha'] == commit and run['head_branch'] == branch and run['path'] == workflow
            and run['event'] == event and run['status'] == 'in_progress'):
        raise ValueError('Execução não corresponde ao fluxo autorizado de publicação.')
    if environment == 'production' and run['actor']['login'] != OWNER:
        raise ValueError('Somente o responsável pelo repositório pode promover produção.')
    git_commit = github('/git/commits/' + commit, token)
    if git_commit['tree']['sha'] != tree:
        raise ValueError('Árvore informada não corresponde ao commit.')
    if github('/git/ref/heads/' + branch, token)['object']['sha'] != commit:
        raise ValueError('O branch avançou. Execute a publicação da versão atual.')

    settings = ENVIRONMENTS[environment]
    target = ROOT / environment
    target.mkdir(mode=0o700, exist_ok=True)
    with (ROOT / 'deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source_commit = commit
        if environment == 'production':
            dev = json.loads((ROOT / 'development' / 'release.json').read_text())
            if dev['tree'] != tree or dev.get('runtime_smoke') != 'passed':
                raise ValueError('Produção exige exatamente a árvore validada em desenvolvimento.')
            digest = dev['digest']
            source_commit = dev['source_commit']
            dev_health = subprocess.check_output(['docker', 'compose', '-p', 'akcit-qa-dev', '--env-file', str(ROOT / 'development' / 'current.env'), '-f', str(ROOT / 'ops' / 'compose.yml'), 'ps', '-q', 'app'], text=True).strip()
            health = subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Health.Status}}', dev_health], text=True).strip()
            if health != 'healthy': raise ValueError('Desenvolvimento não está saudável.')
        else:
            digest = parts[3]

        with tempfile.TemporaryDirectory(prefix='akcit-registry-') as docker_config:
            command_env = {**os.environ, 'DOCKER_CONFIG': docker_config}
            def command(arguments, **kwargs):
                return subprocess.run(arguments, check=True, env=command_env, timeout=600, **kwargs)
            command(['docker', 'login', 'ghcr.io', '-u', OWNER, '--password-stdin'], input=token + '\n', text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            image = IMAGE + '@' + digest
            command(['docker', 'pull', image])
            labels = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .Config.Labels}}', image], text=True))
            if labels.get('io.akcit.git-tree') != tree or labels.get('org.opencontainers.image.revision') != source_commit:
                raise ValueError('Imagem não corresponde ao código aprovado.')
            candidate = target / 'candidate.env'
            candidate.write_text('\n'.join([
                'APP_IMAGE=' + image,
                'APP_ENV=' + environment,
                'APP_REVISION=' + source_commit,
                'APP_PORT=' + settings['port'],
                'APP_CPUS=' + settings['cpus'],
                'APP_MEMORY=' + settings['memory'],
                'RUNTIME_ENV_FILE=' + str(target / 'runtime.env'),
            ]) + '\n')
            candidate.chmod(0o600)
            base = ['docker', 'compose', '-p', settings['project'], '--env-file', str(candidate), '-f', str(ROOT / 'ops' / 'compose.yml')]
            current = target / 'current.env'
            try:
                command(base + ['up', '-d', '--wait', '--wait-timeout', '120', '--pull', 'never'])
                command(base + ['exec', '-T', '-e', 'SMOKE_RESULT_FILE=/data/runtime-smoke.json', 'app', 'node', 'scripts/smoke-runtime.mjs'])
            except Exception:
                if current.exists():
                    rollback = ['docker', 'compose', '-p', settings['project'], '--env-file', str(current), '-f', str(ROOT / 'ops' / 'compose.yml')]
                    command(rollback + ['up', '-d', '--wait', '--wait-timeout', '120', '--pull', 'never'])
                else:
                    command(base + ['down'])
                raise
            if current.exists():
                previous = target / 'previous.env'
                previous.write_text(current.read_text())
                previous.chmod(0o600)
                if (target / 'release.json').exists():
                    (target / 'previous-release.json').write_text((target / 'release.json').read_text())
            candidate.replace(current)
            release = {'environment': environment, 'commit': commit, 'source_commit': source_commit, 'tree': tree, 'digest': digest, 'runtime_smoke': 'passed', 'workflow_run': parts[-1], 'deployed_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            temporary = target / 'release.pending.json'
            temporary.write_text(json.dumps(release, indent=2) + '\n')
            temporary.replace(target / 'release.json')
            print(json.dumps(release))

if __name__ == '__main__':
    os.umask(0o077)
    try:
        environment = sys.argv[1]
        if environment not in ENVIRONMENTS: raise ValueError('Ambiente inválido.')
        original = os.environ.get('SSH_ORIGINAL_COMMAND', '')
        validate_command(environment, original)
        token = sys.stdin.readline(4096).strip()
        if not token or len(token) >= 4095: raise ValueError('Credencial temporária ausente ou inválida.')
        execute(environment, original, token)
    except Exception as error:
        print('Publicação recusada ou falhou: ' + str(error), file=sys.stderr)
        sys.exit(1)
