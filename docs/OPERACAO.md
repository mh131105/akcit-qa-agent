# Operação dos ambientes

## Inventário

Servidor: Ubuntu 24.04, 2 vCPU, cerca de 8 GiB RAM; SSH `matheus@76.13.175.64`.
Raiz do projeto: `/home/matheus/akcit-qa-agent`.

| Ambiente | Compose project | Porta na VPS | CPU máxima | Memória máxima | Volume |
|---|---|---|---|---|---|
| Desenvolvimento | akcit-qa-dev | 127.0.0.1:3101 | 0,75 vCPU | 2 GiB | akcit-qa-dev_app_data |
| Produção | akcit-qa-prod | 127.0.0.1:3102 | 1 vCPU | 3 GiB | akcit-qa-prod_app_data |

Cada ambiente tem seu container, rede, volume e arquivo de segredos. Uma sessão de
navegador por ambiente é o limite inicial de operação. Os especialistas compartilham
o processo do produto; não há um container por especialista. Os modelos serão
consumidos por API; esta configuração não dimensiona inferência de LLM local.

Os limites não são reservas exclusivas: os containers compartilham a CPU física da
VPS. Avaliar concorrência, memória e latência quando o fluxo de agentes existir.
Os serviços Perio, Traefik, PostgreSQL, Redis, Portainer e Gotenberg não são alterados.

## Segurança e credenciais

- Container como usuário `node`, sem privilégios, sem socket do Docker, com
  capabilities removidas e root filesystem somente leitura.
- `/data` persistente e exclusivo por ambiente. `/tmp` e home transitórios.
- Navegador com tela virtual Xvfb. O Chromium deste protótipo usa o isolamento do
  container; não contamos com o sandbox interno do Chromium. Antes de permitir
  navegação aberta a URLs arbitrárias, revisar isolamento por execução e rede.
- Logs limitados a 3 arquivos de 10 MiB por container.
- Nenhuma porta da aplicação publicada na Internet antes do domínio/HTTPS.
- Chaves de publicação distintas com comandos forçados; sem terminal nem túneis.
- Tokens do registry são temporários, provenientes de GITHUB_TOKEN; o publicador
  apaga seu diretório temporário de autenticação ao terminar.
- Chaves da equipe só acessam HTTP de desenvolvimento pelo relay `dev-access.py`.

Os arquivos `development/runtime.env` e `production/runtime.env` na VPS têm modo
600. Configure neles o provedor, modelo e a chave necessária, sem comitar valores.
Credenciais de outros projetos não são copiadas. Após alterar um arquivo, recrie
somente o container do ambiente correspondente.

## Publicação e recuperação

O workflow de desenvolvimento testa a imagem antes do envio ao GHCR, incluindo
os smokes de infraestrutura e da jornada web. A VPS confere
o evento e branch no GitHub, os identificadores de commit/árvore e labels da imagem.
Após subir o container, executa healthcheck e teste de Pi, navegador, cursor e vídeo.
Somente uma publicação bem-sucedida atualiza `release.json` e `current.env`.
Falhas na nova imagem disparam retorno à imagem anterior quando ela existe.

Produção exige execução manual pelo responsável e igualdade entre a árvore de
`main` e a árvore validada em dev. A verificação usa o digest guardado na VPS;
alterar uma tag no registry não troca a imagem promovida. As publicações são
serializadas por lock no servidor.

Consultar status de desenvolvimento:

```sh
cd /home/matheus/akcit-qa-agent
docker compose -p akcit-qa-dev --env-file development/current.env -f ops/compose.yml ps
docker compose -p akcit-qa-dev --env-file development/current.env -f ops/compose.yml logs --tail=100
cat development/release.json
```

Para produção, troque `akcit-qa-dev` por `akcit-qa-prod` e `development` por
`production`. Para uma reversão manual, utilize `previous.env`, verifique o
healthcheck e registre a alteração do release. A reversão de imagem não desfaz
migrações de dados; migrations serão definidas com os requisitos do produto.

Os arquivos `ops/deploy.py`, `ops/dev-access.py` e `ops/compose.yml` são a base de
operação confiável na VPS. Alterações neles devem passar por PR e ser aplicadas
pelo operador via SSH, antes de depender de novas opções em workflows. A aplicação
é atualizada por imagem; seu código não é editado diretamente na VPS.

## Backup

Use `deploy/backup.sh development` ou `deploy/backup.sh production` na VPS, com o
arquivo instalado em `ops/backup.sh`. O script pausa a escrita do container durante
a cópia do volume e reinicia-o mesmo se houver falha. Faz backup dos dados e da
configuração de release, não das chaves do GitHub. Guarde `runtime.env` em um cofre
separado. Copie backups para fora da VPS antes de armazenar dados importantes.

Backups manuais ficam em `backups/`, com permissões restritas. Não há agendamento
nem retenção automática: a política de dados e evidências será definida pela equipe.

## Dados das execuções

`DATA_DIR` configura o diretório de dados (`.data` por padrão no ambiente local).
Nos containers, ele é `/data`, no volume persistente exclusivo de cada ambiente.
Cada execução fica em `DATA_DIR/runs/<runId>.json`, com o registro completo e o
histórico de intenções de trabalho autorizado. A entrada textual de T3.3 fica em
`run.artifacts[].text`, preservada literalmente, com referência em
`run.input.artifactIds`; `run.creation.requestHash` permite repetir a criação.
Esses dados usam o volume existente, sem diretório ou índice adicional.
Os diretórios usam modo `0700` e
os arquivos, `0600`; credenciais permanecem referências, sem segredos no JSON.
Esses arquivos já integram o backup do volume descrito acima. Restaurar uma cópia
deve preservar suas permissões e o proprietário usado pelo serviço.

Antes de disponibilizar o servidor, a aplicação recupera execuções `running`:
grava o estado `interrupted`, motivo `service_restart` e horário UTC, e interrompe
as intenções `pending` dessas execuções. Decisões, versões, conteúdo e histórico
permanecem salvos. Rascunhos, esperas humanas e execuções encerradas mantêm seus
estados. Repetir a recuperação preserva o motivo e horário originais; nenhum
trabalho é executado ou reenviado automaticamente. Como o backup existente para
e reinicia o container, seu reinício também segue essa recuperação.

A atualização protege a sequência de leitura, mudança e gravação com uma trava
compartilhada pelo processo, inclusive para futuras operações de cancelamento.
O registro completo é escrito e sincronizado em arquivo temporário no mesmo
diretório antes da renomeação; falhas anteriores preservam o arquivo definitivo.
Um arquivo inválido causa erro e não é substituído por uma execução vazia.
Essa solução exige **um único processo escritor por ambiente**, como na
implantação atual. Não edite os arquivos enquanto o serviço estiver ativo.
A trava de dados não reserva o navegador; reserva e despacho cabem à orquestração.

### Criar e reencontrar uma entrada textual

`POST /api/runs` exige sessão, origem configurada, JSON de até 16 KiB,
`X-Expected-User-Id` e um `Idempotency-Key` UUID v4. Guarde a identidade esperada
junto da chave e do corpo enviado até receber uma resposta conclusiva. Se houver
queda de conexão ou erro de armazenamento após a
substituição do arquivo, a execução pode já existir: entre na conta original e
repita **a mesma identidade esperada, a mesma chave e o mesmo conteúdo**.
`201` confirma uma nova criação; `200` confirma a execução já persistida, com os
IDs e horário originais. Trocar a chave cria outra execução;
trocar o conteúdo mantendo a chave retorna `409 / IDEMPOTENCY_CONFLICT`.

O exemplo usa somente dados fictícios. Em um ambiente local com
`APP_ORIGIN=http://127.0.0.1:3000`, cadastre primeiro `ana@example.invalid` conforme
o exemplo de T3.2 nos contratos. Os arquivos temporários abaixo ficam fora do
repositório e servem apenas à demonstração:

```sh
qa_demo_dir=$(mktemp -d)
qa_demo_key=8258c5bd-4768-48e5-a348-c0f3a1208f43
cat > "$qa_demo_dir/input.json" <<'JSON'
{"name":"Reservas — exemplo fictício","applicationName":"Aplicação de demonstração","text":"  # US-01\r\nComo usuário, quero reservar itens.\nCA-01: quantidade de 1 a 10.  "}
JSON

curl -sS -c "$qa_demo_dir/cookies" -o "$qa_demo_dir/account.json" \
  http://127.0.0.1:3000/api/auth/login \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"email":"ana@example.invalid","password":"Senha ficticia de exemplo 123"}'
qa_demo_expected=$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).user.id)' "$qa_demo_dir/account.json")
curl -sS -D "$qa_demo_dir/headers" -o "$qa_demo_dir/created.json" \
  -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/runs \
  -H "X-Expected-User-Id: $qa_demo_expected" \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $qa_demo_key" --data-binary "@$qa_demo_dir/input.json"
cat "$qa_demo_dir/headers"
qa_demo_run=$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).id)' "$qa_demo_dir/created.json")
curl -sS -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/runs \
  -H "X-Expected-User-Id: $qa_demo_expected"
curl -sS -b "$qa_demo_dir/cookies" "http://127.0.0.1:3000/api/runs/$qa_demo_run" \
  -H "X-Expected-User-Id: $qa_demo_expected"
```

A criação retorna `201` e `Location`; o histórico contém o rascunho e a consulta
individual retorna `plan: null`. Para demonstrar recuperação, pare o processo
local e inicie-o novamente com o mesmo `DATA_DIR` e configuração. Repita o comando
de login acima para substituir o cookie invalidado pelo reinício, depois os dois
GETs, conservando `qa_demo_expected` capturado para a tentativa original. Uma
consulta posterior de sessão não deve substituí-lo. A execução reaparece com o
mesmo ID e horário. Repita também o POST acima,
sem mudar `qa_demo_key` ou `input.json`: o cabeçalho salvo passa a indicar `200`
e a criação original é preservada. Ao terminar, remova apenas os arquivos dessa
demonstração com `rm -r "$qa_demo_dir"`.

Falha de leitura ou registro corrompido torna o histórico indisponível com
`503 / STORAGE_FAILURE`; não se devolve lista parcial nem caminho interno.
Entradas e metadados da criação já integram o backup do volume. O material recebido
ainda aguarda curadoria: criar não reconhece requisitos, inicia agentes ou consome
modelo. Upload de arquivos, edição e exclusão permanecem pendentes. O acesso
pelo site está documentado em [T2.1](#jornada-pelo-navegador--t21).

## Acesso dos participantes do piloto

Configure no ambiente da aplicação as duas variáveis documentadas em
[`.env.example`](../.env.example). Exemplo local com dados fictícios:

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
PILOT_ALLOWED_EMAILS=ana@example.invalid,bruno@example.invalid
```

`APP_ORIGIN` deve ser a origem exata aberta no navegador: protocolo, host e porta
quando necessária, sem caminho, barra final, credenciais, consulta ou fragmento.
Use HTTPS para um domínio publicado. HTTP só é aceito em loopback, como
`http://127.0.0.1:3000` ou `http://localhost:3000`, para uso local ou pelo túnel
controlado existente. Se o túnel usa outra porta local, configure essa origem;
`localhost` e `127.0.0.1` são origens diferentes. O servidor não usa cabeçalhos do
cliente para definir a origem confiável. Origem informada e inválida é recusada
na configuração; sem origem, a autenticação responde `503 / AUTH_NOT_CONFIGURED`
e o healthcheck permanece disponível.

`PILOT_ALLOWED_EMAILS` recebe e-mails separados por vírgulas. Espaços externos são
removidos e letras convertidas para minúsculas, como no cadastro e no login. Lista
vazia desabilita acesso por contas. Apenas contas da lista podem cadastrar-se e
entrar; remover um e-mail revoga seu acesso. A lista **habilita cadastro, mas não
verifica titularidade do e-mail**. Mantenha o piloto no acesso controlado existente;
incluir um endereço não substitui verificar quem recebeu acesso ao túnel.
Não comite os dados reais dos participantes. Na VPS, configure somente o
`runtime.env` do ambiente pretendido e recrie seu container, preservando os outros
serviços e o fluxo de promoção da imagem validada em desenvolvimento.

As contas ficam em `DATA_DIR/auth/users.json`, com envelope versionado
`{schemaVersion: 1, users: [...]}`. Cada conta possui ID interno, nome, e-mail
normalizado, equipe opcional, criação UTC e hash scrypt com parâmetros e salt;
senhas não são salvas em texto. O diretório usa `0700`, o arquivo `0600`, e a
gravação é atômica. Cadastros serializam leitura, unicidade e escrita no processo.
Assim como execuções, isso pressupõe **um único processo escritor por ambiente**;
não edite as contas com o serviço ativo.

No container, o arquivo é `/data/auth/users.json`, dentro do mesmo volume que as
execuções, e integra automaticamente o backup já descrito nesta página. Preserve
proprietário e permissões ao restaurá-lo; trate backups de contas como dados
privados. `runtime.env` continua no cofre separado. Reiniciar, inclusive pelo
backup, **invalida todas as sessões**, mas preserva contas e execuções: os
participantes entram novamente e reencontram suas decisões. A sessão fica em
memória, expira em oito horas e é invalidada no logout.

A propriedade da execução usa o **ID interno da conta**, conferido pela sessão;
nunca o e-mail enviado no cadastro ou login. Execuções antigas não são atribuídas
a uma conta apenas porque alguém informou o mesmo e-mail. T3.3 cria rascunhos pela
API para a conta da sessão; não realiza migração automática de proprietários.

Todas as operações de `/api/runs` (criação, histórico, detalhe e decisões) e
`POST /api/auth/logout` exigem um único `X-Expected-User-Id`, com o UUID v4
retornado em `user.id` pelo cadastro/login da conta que preparou a operação.
Cadastro, login e `/api/auth/me` não exigem o cabeçalho. Ausência, formato inválido
ou repetição, mesmo com valores iguais, retorna `400 / INVALID_EXPECTED_USER_ID`.
Diferença da conta autenticada retorna `409 / ACCOUNT_CHANGED`, sem acessar
execuções ou encerrar a sessão atual. O cabeçalho é uma precondição; propriedade
e autoria continuam vindo da sessão. Não substitua esse ID pela conta encontrada
em uma consulta posterior nem repita automaticamente a operação com outra conta.

Cadastro/login compartilham limite de dez tentativas por e-mail e trinta por
endereço de conexão em quinze minutos. O endereço é o da conexão direta, sem
confiar em `X-Forwarded-For`; participantes que chegam pelo mesmo relay podem
compartilhar esse limite. O excesso responde `429`. Não registre senhas, cookies
ou hashes para investigar problemas de acesso.

A jornada e os erros estão em
[API autenticada de revisão do plano — T3.2](requisitos/CONTRATOS.md#api-autenticada-de-revisão-do-plano--t32).
Com Node.js 24, execute `node --import tsx --test test/authenticated-api.test.ts`
para reproduzir a jornada HTTP com duas contas, arquivos temporários reais e
relógio controlado. A jornada de criação e histórico de T3.3 está em
[CONTRATOS.md](requisitos/CONTRATOS.md#criação-e-histórico-de-execuções--t33) e é
reproduzida por `node --import tsx --test test/run-intake-api.test.ts`, criando o
rascunho por POST e recuperando-o após reinício e novo login. Os dados sintéticos
são preparados exclusivamente nos testes; nenhuma fixture é carregada pela aplicação.

## Jornada pelo navegador — T2.1

Configure `APP_ORIGIN` e `PILOT_ALLOWED_EMAILS` conforme a seção anterior. Com
Node.js 24 e dependências do `package-lock.json`, um ambiente local fictício pode
ser iniciado assim:

```sh
npm ci
APP_ENV=local HOST=127.0.0.1 PORT=3000 DATA_DIR=.data \
  APP_ORIGIN=http://127.0.0.1:3000 \
  PILOT_ALLOWED_EMAILS=ana@example.invalid,bruno@example.invalid npm run dev
```

Abra [o site local](http://127.0.0.1:3000); a raiz leva ao histórico e solicita
entrada se necessário. Use `/acesso` para cadastrar uma das contas habilitadas,
com nome, e-mail, senha de 15 a 128 caracteres e equipe opcional. Esta é a conta
do produto; o acesso usado pelos agentes na aplicação testada será configurado
separadamente. No ambiente pelo túnel, abra sua origem configurada seguida de
`/acesso`; a porta do navegador pode diferir da porta interna do container.

Em “Nova execução”, preencha nome, aplicação, objetivo opcional e texto das
histórias de usuário e critérios de aceite. “Salvar rascunho” persiste a entrada
e abre o detalhe. O rascunho informa que o processamento ainda não começou.
O histórico permite busca, filtro por situação e reabertura após recarregar ou
entrar novamente. Quando o armazenamento já contém um plano, o detalhe mostra
conteúdo, revisão e validação; as decisões disponíveis usam essa revisão e são
reconsultadas depois de salvas. Aprovar o plano mantém a espera.

Os nomes têm limite de 120 caracteres, o objetivo de 2.000, e **todo o JSON de
entrada** de 16 KiB UTF-8. Não há upload ou campo de credenciais neste formulário.
Texto de US/CA é preservado como digitado. O detalhe ainda não devolve o texto
original, board ou perguntas.

Antes de enviar, a interface guarda em `sessionStorage` a chave UUID v4, o corpo
exato e o ID da conta. Se a resposta se perder, use “Tentar confirmar salvamento”
para recuperar a criação sem duplicá-la. A tentativa permanece **na mesma aba e
para a mesma conta, até confirmação ou logout confirmado**, inclusive após
atualizar a página. Não é um backup entre abas ou dispositivos. Fechar a aba ou
limpar o armazenamento do navegador pode impedir a recuperação. Se a sessão
expirar, os dados privados saem da tela e o formulário só é restaurado após
confirmar novamente a mesma conta. Outra conta não recebe esse conteúdo.
O preenchimento ainda não enviado pode ser guardado ao sair da página ou quando
a sessão é retirada, se o armazenamento estiver disponível; isso não cria uma
execução no servidor nem representa salvamento contínuo. A interface confere a
sessão a cada 30 segundos com a aba visível e ao voltar para ela. Durante essa
última conferência, oculta o conteúdo; uma falha também solicita nova entrada.
Se o navegador impedir salvar a tentativa, a página informa o problema e não
envia um POST sem recuperação. Senha e token não são gravados pelo frontend.

Se o logout falhar por rede ou `503`, a interface informa: “Não foi possível
confirmar a saída. Sua tentativa de salvamento foi preservada.” Chave, corpo,
conta original e mecanismo de recuperação permanecem. A sessão pode já ter sido
encerrada no servidor: ao confirmar que ela é inválida, a interface retira os
dados privados, mas permite recuperar a tentativa após entrar novamente na conta
original. `ACCOUNT_CHANGED` também oculta os dados, sem encerrar a sessão da
outra conta. Consultar a sessão periodicamente é proteção visual complementar;
o cabeçalho garante a precondição no próprio pedido HTTP.

Somente `204` confirma o logout e autoriza limpar a recuperação. Primeiro a
interface impede regravação pelo formulário ou `pagehide`, interrompe a verificação de
sessão e remove os dados privados. Depois limpa o armazenamento e abre o acesso.
Se a limpeza local falhar, informa esse problema e mantém a sessão tratada como
encerrada; não retorna à tela privada nem anuncia falha de logout.

O comentário de uma decisão fica em memória com conta, execução, saída e revisão
originais. Uma falha no POST ou na consulta posterior preserva espaços e quebras
de linha. Na mesma revisão sem decisão, a reconsulta restaura o comentário para
nova ação explícita. Se a decisão já foi salva, mostra a confirmação do servidor;
se a revisão mudou ou há decisão conflitante, mantém o texto anterior somente
para leitura/cópia, identificado pela revisão original. Não aplica esse texto em
outra revisão nem repete o POST automaticamente. A cópia só aparece para a mesma
conta e execução durante as reconstruções da página atual; fechar a aba ou
recarregar completamente a página perde essa cópia em memória.

### Reproduzir a jornada com dados fictícios

O smoke não utiliza contas nem execuções do ambiente em operação. Ele cria seu
próprio servidor com armazenamento temporário e configura a origem para o
endereço realmente aberto no Chromium, sem contornar a conferência de `Origin`.
Inclui cadastro/entrada, criação, histórico, detalhe, atualização, novo login,
resposta perdida após persistência, repetição sem duplicação, isolamento entre
contas, texto semelhante a HTML, aprovação e pedido de alteração persistidos.
Planos e pareceres são sintéticos e preparados somente nos dados temporários do
teste; não há geração por IA, chamada paga ou carga automática na aplicação.

As regressões de BUG-T2.1-01 são reproduzidas no mesmo smoke, com navegador,
API e arquivos de persistência reais:

1. Duas abas compartilham cookies. O teste atrasa uma resposta de `/auth/me` da
   conta A, entra na conta B pela outra aba e libera a resposta antiga. O envio
   preparado por A deve receber `ACCOUNT_CHANGED`, sem criar execução para B;
   ao voltar à conta A, a tentativa conserva chave e corpo.
2. Após persistir uma execução, o teste perde a resposta de criação e faz o
   logout falhar. Recarrega a página, confirma a mesma conta e verifica chave e
   corpo originais; a repetição explícita encontra a execução já salva. Também
   cobre logout confirmado, perda de sua resposta e falha de limpeza local após
   `204`, sem regravação do material por `pagehide`.
3. O pedido de alteração falha antes da gravação, perde a resposta depois de
   gravar e encontra falha na consulta de recuperação. O teste verifica o texto
   literal, ausência de duplicação e de POST automático. Ao mudar a revisão,
   verifica que o texto anterior continua identificado e disponível para cópia,
   sem preencher o comentário da revisão nova.

As suítes HTTP existentes cobrem também cabeçalho ausente, inválido,
duplicado e divergente em criação, consultas, decisões e logout. O caso de logout
divergente confirma que a sessão de B continua válida. Os helpers conservam o ID
original da operação; não consultam a conta atual para substituí-lo silenciosamente.
Consulte o resultado gerado pelo smoke para saber quais verificações passaram;
o procedimento e os cenários descritos aqui não substituem essa evidência.

Verificações locais, usando Node.js 24 e um Chromium instalado:

```sh
npm run check
npm test
npm run build
CHROMIUM_PATH=/usr/bin/chromium SMOKE_ARTIFACT_DIR=artifacts/web npm run smoke:web
```

Defina `CHROMIUM_PATH` para o executável instalado quando estiver em outro
endereço. Para conferir a imagem final nas mesmas restrições dos workflows:

```sh
docker build --target runtime -t akcit-qa:ci .
docker run --rm --cpus=1 --memory=2g --shm-size=512m \
  --cap-drop=ALL --security-opt=no-new-privileges --read-only \
  --tmpfs /tmp:rw,size=512m,mode=1777 \
  --tmpfs /home/node:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  --tmpfs /data:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  akcit-qa:ci node scripts/smoke-runtime.mjs
docker run --rm --cpus=1 --memory=2g --shm-size=512m \
  --cap-drop=ALL --security-opt=no-new-privileges --read-only \
  --tmpfs /tmp:rw,size=512m,mode=1777 \
  --tmpfs /home/node:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  --tmpfs /data:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  akcit-qa:ci node scripts/smoke-web.mjs
```

Para guardar capturas e o resultado, crie `artifacts/web` no host com permissão de
escrita para UID 1000 e acrescente `-e SMOKE_ARTIFACT_DIR=/evidence` e
`-v "$PWD/artifacts/web:/evidence"` ao segundo `docker run`. A saída inclui
`web-desktop.png` (1366 px), `web-mobile.png` (390 px), `web-plan.png` e
`web-result.json`. Esses arquivos contêm somente a demonstração sintética;
`artifacts/` é ignorado pelo Git. Não versionar sessões, evidências privadas ou
dados dos participantes. A CI verifica ambos os smokes na imagem de runtime;
desenvolvimento executa os mesmos checks antes de publicar. A promoção para
produção continua usando a imagem já validada em desenvolvimento.

## Referências

- [SDK do Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Docker Compose em produção](https://docs.docker.com/compose/how-tos/production/)
- [Limites de ambientes por plano GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
