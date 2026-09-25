# T7 — Evidências da aplicação controlada de reservas

## Commit

Branch: `feat/controlled-reservations-target`
Commit: _(preencher após commit)_

## Ambiente

- Node.js 24
- Chromium: versão da imagem do projeto
- Container: `akcit-qa:ci` com as restrições do CI

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

_(preencher com saída do smoke e capturas)_

## Limitações

- O smoke não testa o Chromium da imagem com acesso por hostname do container
  para o alvo na mesma máquina — usa loopback.
- Nenhuma chamada de modelo paga.
- O defeito intencional é comprovado pela asserção do teste, não por observação
  humana.
