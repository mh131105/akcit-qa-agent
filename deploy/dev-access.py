#!/usr/bin/env python3
"""Canal SSH limitado ao HTTP de desenvolvimento, sem shell nem forwarding livre."""
import os
import selectors
import socket
import sys

if os.environ.get('SSH_ORIGINAL_COMMAND') != 'akcit-dev-access':
    sys.exit('Esta chave só permite acessar o ambiente de desenvolvimento.')
with socket.create_connection(('127.0.0.1', 3101), timeout=15) as connection:
    connection.settimeout(None)
    with selectors.DefaultSelector() as selector:
        selector.register(sys.stdin.buffer, selectors.EVENT_READ)
        selector.register(connection, selectors.EVENT_READ)
        while True:
            events = selector.select(timeout=120)
            if not events: break
            for key, _ in events:
                if key.fileobj is connection:
                    data = connection.recv(65536)
                    if not data: sys.exit(0)
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                else:
                    data = os.read(sys.stdin.fileno(), 65536)
                    if not data:
                        connection.shutdown(socket.SHUT_WR)
                        selector.unregister(sys.stdin.buffer)
                    else:
                        connection.sendall(data)
