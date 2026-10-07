#!/usr/bin/env python3
"""Transição única das contas legadas; operar somente com o serviço parado."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

ROOTS = ('auth', 'runs', 'artifacts', 'media')


def safe_path(value):
    path = Path(os.path.abspath(value))
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Links simbólicos não são permitidos.')
    return path


def inventory(directory):
    result = {}
    for name in ROOTS:
        root = directory / name
        if not root.exists() and not root.is_symlink():
            continue
        if root.is_symlink() or not root.is_dir():
            raise ValueError('Cada raiz de dados deve ser um diretório real.')
        for path in [root, *sorted(root.rglob('*'))]:
            mode = path.lstat().st_mode
            relative = path.relative_to(directory).as_posix()
            if stat.S_ISDIR(mode):
                result[relative] = {'kind': 'directory'}
            elif stat.S_ISREG(mode) and path.stat().st_nlink == 1:
                with path.open('rb') as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                result[relative] = {'kind': 'file', 'bytes': path.stat().st_size, 'sha256': digest}
            else:
                raise ValueError('Dados contêm links ou arquivos especiais; nada foi removido.')
    return result


def copy_roots(source, destination):
    for name in ROOTS:
        if (source / name).exists():
            shutil.copytree(source / name, destination / name, copy_function=shutil.copyfile)
    for path in destination.rglob('*'):
        path.chmod(0o700 if path.is_dir() else 0o600)
        if path.is_file():
            with path.open('rb') as stream:
                os.fsync(stream.fileno())
    for path in [*sorted((p for p in destination.rglob('*') if p.is_dir()), reverse=True), destination]:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def paths(data_dir, archive_dir, service_stopped):
    if not service_stopped:
        raise ValueError('Pare o serviço e informe --service-stopped explicitamente.')
    data, archive = safe_path(data_dir), safe_path(archive_dir)
    if not data.is_dir() or not archive.parent.is_dir():
        raise ValueError('DATA_DIR e o diretório pai do arquivo privado devem existir.')
    if data == archive or data in archive.parents or archive in data.parents:
        raise ValueError('O arquivo privado deve ficar fora de DATA_DIR.')
    if any((parent / '.git').exists() for parent in (archive, *archive.parents)):
        raise ValueError('O arquivo privado não pode ficar dentro de um repositório Git.')
    if archive.parent.stat().st_mode & 0o077:
        raise ValueError('O diretório pai do arquivo privado deve ter permissão 0700.')
    return data, archive


def read_archive(archive):
    if archive.stat().st_mode & 0o077:
        raise ValueError('O arquivo privado deve ter permissão 0700.')
    manifest_path = safe_path(archive / 'manifest.json')
    payload = safe_path(archive / 'data')
    if not manifest_path.is_file() or not payload.is_dir():
        raise ValueError('Arquivo privado incompleto.')
    manifest = json.loads(manifest_path.read_text())
    if not isinstance(manifest, dict) or manifest.get('version') != 1 or manifest.get('files') != inventory(payload):
        raise ValueError('Verificação do arquivo privado falhou; nada foi removido.')
    return payload, manifest['files']


def archive_accounts(data_dir, archive_dir, service_stopped=False):
    data, archive = paths(data_dir, archive_dir, service_stopped)
    if archive.exists():
        raise ValueError('Escolha um novo diretório de arquivo; não há sobrescrita.')
    before = inventory(data)
    if before.get('auth/users.json', {}).get('kind') != 'file' or any(name.startswith('auth/users.sqlite') for name in before):
        raise ValueError('Esta operação aceita somente contas legadas, antes da criação do SQLite.')
    archive.mkdir(mode=0o700)
    payload = archive / 'data'
    payload.mkdir(mode=0o700)
    copy_roots(data, payload)
    with (archive / 'manifest.json').open('x', encoding='utf8') as stream:
        os.chmod(stream.name, 0o600)
        json.dump({'version': 1, 'files': before}, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    _, expected = read_archive(archive)
    # Reconstruir em outra pasta e comparar os bytes antes de tocar nos originais.
    with tempfile.TemporaryDirectory(prefix='.verify-', dir=archive) as temporary:
        restored = Path(temporary)
        copy_roots(payload, restored)
        if inventory(restored) != expected or inventory(data) != expected:
            raise ValueError('A reconstrução divergiu ou os dados mudaram; nada foi removido.')
    for directory in [archive, archive.parent]:
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    for name in ROOTS:
        if (data / name).exists():
            shutil.rmtree(data / name)
    descriptor = os.open(data, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return len([entry for entry in expected.values() if entry['kind'] == 'file'])


def restore_accounts(data_dir, archive_dir, service_stopped=False):
    data, archive = paths(data_dir, archive_dir, service_stopped)
    if any((data / name).exists() or (data / name).is_symlink() for name in ROOTS):
        raise ValueError('A restauração exige raízes de dados vazias; preserve os dados atuais separadamente.')
    payload, expected = read_archive(archive)
    # Validar a cópia inteira antes de publicar qualquer raiz restaurada.
    with tempfile.TemporaryDirectory(prefix='.restore-', dir=data) as temporary:
        restored = Path(temporary)
        copy_roots(payload, restored)
        if inventory(restored) != expected:
            raise ValueError('A reconstrução divergiu; destino preservado.')
        for name in ROOTS:
            if (restored / name).exists():
                (restored / name).rename(data / name)
    descriptor = os.open(data, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['archive', 'restore'])
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--archive-dir', required=True)
    parser.add_argument('--service-stopped', action='store_true', required=True,
                        help='Confirma que o operador parou o serviço e todos os escritores.')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.operation == 'archive':
            count = archive_accounts(args.data_dir, args.archive_dir, args.service_stopped)
            print(f'Arquivo privado verificado: {count} arquivos. Contas e execuções ativas foram reiniciadas.')
        else:
            restore_accounts(args.data_dir, args.archive_dir, args.service_stopped)
            print('Dados restaurados e verificados. Inicie somente a imagem compatível com essas contas.')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Operação interrompida: {error}\n')
