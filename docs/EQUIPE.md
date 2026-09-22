# Acesso da equipe

Repositório privado: https://github.com/mh131105/akcit-qa-agent

| Integrante | Repositório | Desenvolvimento remoto |
|---|---|---|
| mh131105 | Administrador | Túnel SSH administrativo já existente |
| contraexemplo-0 | Convite com permissão de escrita | Chave pública do GitHub autorizada no acesso restrito |
| davideca88 | Convite com permissão de escrita | Chaves públicas do GitHub autorizadas no acesso restrito |
| ErickG05 | Convite com permissão de escrita | Cadastro de chave adiado a pedido do responsável |

Cada integrante precisa aceitar o convite do GitHub. O convite não autoriza um
terminal na VPS. Os acessos de desenvolvimento usam `npm run dev:remote`, conforme
o README; a configuração não acompanha mudanças futuras nas chaves do GitHub.

Para habilitar Erick ou uma nova chave, o responsável deve obter a chave pública
do integrante e adicionar em `/home/matheus/.ssh/authorized_keys` uma linha com o
mesmo prefixo restritivo dos demais acessos `akcit-dev-viewer-*`:

```text
restrict,command="/usr/bin/python3 /home/matheus/akcit-qa-agent/ops/dev-access.py" TIPO CHAVE_PUBLICA akcit-dev-viewer-USUARIO
```

Nunca substituir o arquivo inteiro nem compartilhar chaves privadas. Para revogar
o acesso remoto, remover apenas as linhas do integrante; revogar o acesso no GitHub
separadamente. Produção permanece sob responsabilidade de mh131105.
