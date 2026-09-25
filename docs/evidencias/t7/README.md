# T7 — Evidências da aplicação controlada de reservas

## Commit

Branch: `feat/controlled-reservations-target`
Código validado: `7ef923c` (correção sobre `c333a6a`).
PR: [#27](https://github.com/mh131105/akcit-qa-agent/pull/27).

## Ambiente

- Node.js 24.21.0; Chromium 153.0.8010.52; Debian 12.
- Imagem runtime construída localmente como `akcit-qa:pr27-fix`, com as
  restrições do CI: 1 CPU, 2 GiB de memória, filesystem somente leitura,
  capacidades removidas e diretórios temporários em tmpfs.

## Comandos de verificação

```bash
npm run check
npm test
npm run build
npm run demo:target          # iniciar localmente
npm run smoke:target         # jornada no navegador
```

### No container

```bash
docker build --target runtime -t akcit-qa:ci .
docker run --rm --cpus=1 --memory=2g --shm-size=512m \
  --cap-drop=ALL --security-opt=no-new-privileges --read-only \
  --tmpfs /tmp:rw,size=512m,mode=1777 \
  --tmpfs /home/node:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  --tmpfs /data:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  -e SMOKE_ARTIFACT_DIR=/evidence -v "$PWD/artifacts/target:/evidence" \
  akcit-qa:ci node scripts/smoke-target.mjs
```

## Resultados

Validação local em 25/09/2026:

- `npm run check`: aprovado.
- `npm test`: 158 testes aprovados, incluindo 14 do alvo.
- Build da imagem runtime (inclui `npm run build`): aprovado.
- Na mesma imagem: smoke runtime com 7 verificações; smoke web com 33;
  smoke do alvo com 15. Todos aprovados.
- Testes de deploy: 6 aprovados (`python3 -m unittest discover -s deploy -p 'test_*.py'`).
- Resultado do alvo: [target-result.json](target-result.json), duração de 4.315 ms.

### Falha do CI e regressão

O [CI original](https://github.com/mh131105/akcit-qa-agent/actions/runs/36093025234)
falhou porque o smoke encontrou duas reservas quando esperava uma. A falha foi
reproduzida localmente: o POST retornava a lista diretamente e recarregá-la
reenviava o formulário, duplicando a reserva.

O alvo agora responde ao POST com 303 para GET `/reservas`, tanto na criação
quanto na rejeição. A mensagem é consumida uma única vez na sessão. O teste de
regressão falhou antes da correção (200 em vez de 303) e passou depois, nos dois
modos. O smoke confirma GET após recarregar e compara as mesmas linhas da lista,
incluindo seus IDs, para detectar duplicações.

Estes resultados são da execução local na imagem final. O resultado remoto da
branch deve ser consultado nos checks do PR.

## Limitações

- O smoke não testa o Chromium da imagem com acesso por hostname do container
  para o alvo na mesma máquina — usa loopback.
- Nenhuma chamada de modelo paga.
- O defeito intencional é comprovado pela asserção do teste, não por observação
  humana.
