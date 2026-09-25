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
Respostas de esclarecimento ficam em `run.answers`, com texto citável separado
em `run.answerArtifacts`; os originais não são substituídos. Esses dados usam
o volume existente, sem diretório ou índice adicional.
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
compartilhada pelo processo, inclusive para o cancelamento de T4.1.
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

Configure no ambiente da aplicação as variáveis documentadas em
[`.env.example`](../.env.example). Exemplo local com dados fictícios:

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
PILOT_ALLOWED_EMAILS=ana@example.invalid,bruno@example.invalid
TARGET_ALLOWED_ORIGINS=http://127.0.0.1:4000,https://alvo.exemplo.test
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

`TARGET_ALLOWED_ORIGINS` recebe uma lista de origens autorizadas separadas por vírgula
para alvos de teste (ex.: `http://127.0.0.1:4000,https://alvo.exemplo.test`).
Cada entrada deve ser uma origem exata (protocolo + hostname + porta opcional),
sem caminho, barra final, query string ou fragmento. Apenas protocolos `http:` e `https:`
são aceitos. Uma lista vazia ou não configurada não impede a preparação textual ou rascunhos,
mas recusa a configuração de qualquer alvo na rota `PATCH /api/runs/:id` (`403 / TARGET_NOT_ALLOWED`).
Alvos locais (como o alvo de demonstração T7) precisam estar explicitamente listados.

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
requisitos: US/CA, prosa, requisitos funcionais ou Gherkin textual opcional.
“Salvar rascunho” persiste a entrada
e abre o detalhe. O rascunho informa que o processamento ainda não começou.
O histórico permite busca, filtro por situação e reabertura após recarregar ou
entrar novamente. Quando o armazenamento já contém um plano, o detalhe mostra
conteúdo, revisão e validação; as decisões disponíveis usam essa revisão e são
reconsultadas depois de salvas. Aprovar o plano mantém a espera.

Os nomes têm limite de 120 caracteres, o objetivo de 2.000, e **todo o JSON de
entrada** de 16 KiB UTF-8. Não há upload ou campo de credenciais neste formulário.
O texto é preservado como digitado. O detalhe não devolve originais completos;
a preparação apresenta curadoria, regras, exemplos, perguntas e progresso.
O ajuste de 24/09 acrescenta resposta e retomada explícitas descritas abaixo.

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
Planos e pareceres são sintéticos. Em T4.1, o smoke também percorre “Preparar
plano”, polling, pendências e cancelamento pelo coordenador real, substituindo
explicitamente a chamada de modelo apenas na criação do servidor de teste.
Não há geração por IA, chamada paga ou carga automática na aplicação.

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

## Modelos e preparação do plano — T4.1

Use Node.js 24, `package-lock.json` e Pi 0.87.0. Cada ambiente tem sua própria
configuração privada; o padrão é o par `PI_PROVIDER` / `PI_MODEL`. Os três papéis
podem usar esse mesmo modelo em sessões independentes. Substituições opcionais:

| Papel | Par completo de substituição |
| --- | --- |
| Curador | `PI_CURATOR_PROVIDER` / `PI_CURATOR_MODEL` |
| Planejador | `PI_PLANNER_PROVIDER` / `PI_PLANNER_MODEL` |
| Validador | `PI_VALIDATOR_PROVIDER` / `PI_VALIDATOR_MODEL` |

Deixar ambos vazios herda o padrão. Definir somente metade do par recusa o início;
não há modelo alternativo automático. Use identificadores disponíveis no catálogo
da versão instalada do Pi. Por padrão, credenciais vêm somente do ambiente do
processo, como `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou `GEMINI_API_KEY`, conforme
o provedor. Para OAuth de assinatura, `PI_AUTH_PATH` habilita explicitamente um
`auth.json` privado desse ambiente. Sem esse caminho, nenhum arquivo pessoal do
Pi é procurado. Sessões e modelos pessoais não são carregados. Nunca coloque
chaves ou tokens nas skills, no registro da execução ou no repositório.

Para autorizar uma assinatura OpenAI pelo fluxo nativo do Pi, na raiz do projeto:

```sh
umask 077
mkdir -p .data/pi
PI_CODING_AGENT_DIR="$PWD/.data/pi" npm run pi
```

No Pi, use `/login`, selecione o provedor OpenAI Codex e conclua a autorização
no navegador com a conta pretendida. Não envie prompts durante essa configuração.
O Pi salva e renova OAuth no `auth.json` desse diretório. Em seguida, configure
privadamente `PI_AUTH_PATH` com o caminho absoluto para `.data/pi/auth.json`,
`PI_PROVIDER=openai-codex` e `PI_MODEL` com o identificador explícito disponível
no catálogo instalado. Cada substituição por papel continua exigindo par completo.
Não copie a autenticação pessoal do Codex/Pi para completar esse fluxo.

Na VPS, a autorização deve usar o diretório privado do ambiente correspondente
(`PI_CODING_AGENT_DIR=/data/pi` dentro daquele container); configure
`PI_AUTH_PATH=/data/pi/auth.json` somente nesse ambiente. Diretório com modo
`0700`, arquivo com `0600`, gravável pelo usuário do serviço para renovação nativa
dos tokens. Não monte diretórios pessoais do host nem compartilhe esse arquivo
entre dev/prod. Se guardado no volume `/data`, o arquivo OAuth também entra no
backup privado do volume. `PI_CODING_AGENT_DIR` configura a CLI de login;
`PI_AUTH_PATH` é a autorização explícita para o runtime da aplicação usar o arquivo.
Isso não habilita tools, histórico compartilhado ou escolha automática de modelo.

Localmente, mantenha a configuração em `.env` ignorado, com modo `0600`, incluindo
`DATA_DIR=.data`, origem local exata e participantes habilitados. O servidor não
lê `.env` sozinho: carregue-o explicitamente pelo Node ou injete as variáveis no
processo. Após preencher privadamente os pares e a credencial:

```sh
npm ci
npm run check
npm test
npm run build
node --env-file=.env dist/server.js
```

Na VPS, use o `development/runtime.env` ou `production/runtime.env` correspondente,
com modo `0600`; recrie somente aquele container. Não altere outros serviços.
Promova para produção a mesma imagem já validada em dev pelo procedimento existente;
mudança de credencial/configuração é separada da promoção da imagem.

Salvar rascunho continua possível sem modelo configurado. “Preparar plano” confere
configuração, modelo no catálogo e credencial antes do aceite. Mensagens legíveis
`MODEL_NOT_CONFIGURED`, `MODEL_UNAVAILABLE` e `CREDENTIAL_UNAVAILABLE` preservam o
rascunho; exceções do provedor são sanitizadas. Credencial presente não garante
aceitação pelo serviço remoto: uma recusa na inferência fica como falha técnica.

`allowModelNetwork: false` impede atualização do catálogo, **não impede inferência
paga**. Os testes substituem explicitamente `modelCall`/`modelPreflight` na montagem
interna; não existe opção de simulação na API, no site ou no ambiente de produção.
O smoke de runtime continua criando sessão sem inferência. Os testes de runtime
substituem execução/autenticação deliberadamente para não chamar provedores.

### Política de distribuição de modelos e API DeepSeek

A política de modelos define o provedor oficial `deepseek` (API oficial em `https://api.deepseek.com`) como a configuração padrão do protótipo. O catálogo do Pi 0.87.0 reconhece `deepseek/deepseek-flash` (V4.1 Flash, aceita texto e imagem) e `deepseek/deepseek-v4-pro` (aceita somente texto). Essa restrição técnica determina o uso obrigatório de `deepseek-flash` em tarefas que envolvam evidências visuais (mapeamento, execução e validação visual).

Substituindo a regra anterior simplificada de "Flash sempre low; Pro sempre high", o runtime agora opera com **nível de raciocínio (`thinkingLevel`) explicitamente configurado** (`off`, `low` ou `high`), permitindo que o mesmo modelo Flash trabalhe com `low` ou `high` conforme a sensibilidade da tarefa.

#### Matriz de distribuição de modelos

| Agente | Tarefa | Modelo | Reasoning | Situação no protótipo |
|---|---|---|---|---|
| Orquestrador | Controlar etapas, delegar e aplicar transições | Sem modelo: lógica do backend | Não se aplica | Integrado (determinístico) |
| Curador | Normalizar artefatos, preservar significado e apontar dúvidas | `deepseek-flash` | `low` | Integrado (T4.1) |
| Projetista de testes | Elaborar plano e casos, aplicando PCE e AVL | `deepseek-v4-pro` | `high` | Integrado (T4.1 / T6.1) |
| Projetista de testes | Associar percursos observados aos casos aprovados (`route_detail`) | `deepseek-v4-pro` | `high` | Etapa futura (planejada) |
| Executor | Explorar a aplicação e mapear a navegação | `deepseek-flash` | `high` | Etapa futura (planejada) |
| Executor | Executar casos, observar resultados e reproduzir problemas | `deepseek-flash` | `high` | Etapa futura (planejada) |
| Redator | Consolidar resultados validados no relatório | `deepseek-flash` | `low` | Etapa futura (planejada) |
| Validador | Revisar curadoria, plano, casos, detalhamento dos percursos e relatório textual | `deepseek-v4-pro` | `high` | Curadoria/plano/casos integrados; demais etapas futuras |
| Validador | Revisar mapa e resultados que dependam de evidência visual | `deepseek-flash` | `high` | Etapa futura (planejada) |

**Justificativas técnicas e de processo:**
- A preparação textual mantém a configuração testada e exercitada em execução real (Curador em Flash/low, Projetista e Validador em Pro/high).
- Mapeamento, execução e validação visual começam com `high`, priorizando a profundidade de análise enquanto ainda não dispomos de medições empíricas dessas tarefas.
- O redator consolida conclusões já previamente validadas; novas interpretações de comportamento devem ser devolvidas à etapa técnica responsável, justificando raciocínio `low`.
- O orquestrador é determinístico no backend. O julgamento semântico e de qualidade pertence exclusivamente ao validador independente.
- Tarefas visuais utilizam obrigatoriamente `deepseek-flash`, único modelo do catálogo com suporte a imagens. Conclusões ou validações que dependam de imagem não podem ser delegadas ao perfil Pro.

#### Configuração privada (Local e VPS)

Configuração explícita para ambientes local e de desenvolvimento:

```dotenv
DEEPSEEK_API_KEY=<chave privada do projeto>
PI_PROVIDER=deepseek
PI_MODEL=deepseek-v4-pro
PI_THINKING_LEVEL=high
PI_AUTH_PATH=

PI_CURATOR_PROVIDER=deepseek
PI_CURATOR_MODEL=deepseek-flash
PI_CURATOR_THINKING_LEVEL=low

PI_PLANNER_PROVIDER=deepseek
PI_PLANNER_MODEL=deepseek-v4-pro
PI_PLANNER_THINKING_LEVEL=high

PI_VALIDATOR_PROVIDER=deepseek
PI_VALIDATOR_MODEL=deepseek-v4-pro
PI_VALIDATOR_THINKING_LEVEL=high
```

O runtime recebe `thinkingLevel` explicitamente resolvido e o repassa à sessão Pi. Valores inválidos geram erro imediato na inicialização. Para garantir compatibilidade retroativa, a ausência da variável de raciocínio aplica o padrão inferido do modelo (`deepseek-v4-pro` → `high`; `deepseek-flash` → `low`; demais modelos/provedores → `off`).

Localmente, configure esses valores no `.env` privado antes de iniciar o processo. Na VPS, configure-os exclusivamente em `development/runtime.env` (modo `0600`) e recrie o container `akcit-qa-dev`. A mudança não configura produção e credenciais nunca devem ser expostas em logs, repositório ou commits.

> **Ressalva factual:** A execução existente comprova a integração técnica da preparação textual; ainda não comprova a qualidade do navegador, do relatório ou da validação visual, nem superioridade entre modelos.

A verificação real com seis casos está registrada em [evidências DeepSeek](evidencias/deepseek/README.md). O custo registrado pelo Pi é estimativa do catálogo, não conciliação da cobrança da DeepSeek, que pode depender de cache e horário.

Referências: [modelos e preços](https://api-docs.deepseek.com/quick_start/pricing/) e [controle de raciocínio](https://api-docs.deepseek.com/guides/thinking_mode/).

### Demonstração com modelo real pelo site

**Configuração da demonstração local:** em 24/09/2026, o responsável concluiu o
OAuth da assinatura OpenAI no Pi. `openai-codex/gpt-6-astra` foi selecionado
explicitamente para os três papéis e usado em inferências reais. A configuração
privada local não configura dev/prod automaticamente. Resultados, revisões e
pendências humanas estão em [evidencias/t4.1](evidencias/t4.1/README.md).
Testes com respostas programadas não atendem CA-12 nem a definição de pronto.

1. Registrar commit/imagem e os pares usados, sem chaves. Abrir o site na origem
   configurada e entrar com participante habilitado. Criar execução sintética e
   colar integralmente [artefato-demo.md](requisitos/exemplos/artefato-demo.md),
   que contém somente US-01 e CA-01/CA-02. Notas de avaliação e identificação
   sintética ficam fora do texto enviado; não fornecer percurso nem gabarito.
   Objetivo é opcional; não exigir URL/credencial da aplicação testada.
2. Salvar rascunho e clicar **Preparar plano**. Conferir aceite `202`, atualização
   de fase/papel e registro do processamento. Curador, validador da curadoria,
   planejador e validador do plano fazem chamadas reais; correções podem ampliar
   essa sequência dentro dos limites.
3. Em `awaiting_approval/planning`, a frente C compara plano e revisões com os
   originais e confere as duas validações. O registro privado em
   `DATA_DIR/runs/<id>.json` permite auditar revisões, pareceres, dependência exata
   e `preparation.calls`; a consulta HTTP devolve somente a projeção pública.
4. Conferir quantidade **inteira de 1 a 10 inclusive**, sucesso e rejeição sem
   reserva conforme CA-01, **comentário opcional** e persistido quando informado
   conforme CA-02, fontes literais, cobertura e exclusões justificadas. Nenhum
   percurso foi fornecido; não deve haver navegação presumida ou casos detalhados.
5. A pessoa revisora aprova pelo botão **Aprovar plano**. Reconsultar e confirmar
   autor, horário e revisão da decisão, mantendo `awaiting_approval/planning`.
   Recarregar não perde a decisão. Esse roteiro histórico de T4.1 termina aqui;
   para continuar na versão atual, siga [T6.1](#gerar-e-consultar-casos-lógicos--t61).
6. Preencher [evidencias/t4.1](evidencias/t4.1/README.md) com os dados sintéticos,
   revisões/pareceres, avaliação assinada pela frente C, duração e consumo
   disponível. Custo por API do Pi deve ser identificado como estimativa; com
   assinatura OAuth, `estimatedCost` é omitido, pois a tarifa por token do catálogo
   não representa a cobrança da assinatura. Tokens disponíveis continuam registrados.
   Não publicar arquivo de conta, sessão, credencial ou material privado.

### Avaliação real do validador com erro conhecido

A frente C mantém seu gabarito fora do contexto do agente. Em diretório privado,
copie **somente o payload** de uma curadoria real e altere deliberadamente um
enunciado: limite superior de 10 para 11 ou comentário opcional para obrigatório.
Mantenha IDs, fontes e originais intactos; não envie o motivo da adulteração,
resultado esperado ou notas do avaliador. O ensaio não modifica a execução nem
suas aprovações. Execute uma tarefa real independente de `output-validator` com
envelope `{task: 'validation', artifacts, objective, output, previousVerdicts: []}`:

```sh
# Caminhos privados e ID da execução sintética; nunca usar documento de participante.
export QA_DEMO_RUN_ID='<id-da-execucao-sintetica>'
export QA_NEGATIVE_PAYLOAD='<caminho-absoluto-do-payload-alterado.json>'
export QA_NEGATIVE_RESULT='<caminho-absoluto-do-parecer.json>'
node --env-file=.env --input-type=module <<'JS'
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readConfig, resolvePreparationModels } from './dist/config.js';
import { RunStore } from './dist/storage/runs.js';
import { parseCuration, parseVerdict } from './dist/domain/preparation.js';
import { executeSpecialistTask, preflightSpecialists } from './dist/runtime/pi.js';
const config = readConfig();
const models = resolvePreparationModels(config);
await preflightSpecialists(models, config.piAuthPath);
const { run } = await new RunStore(config.dataDir).read(process.env.QA_DEMO_RUN_ID);
const original = run.outputs.filter(item => item.phase === 'curation').at(-1);
if (!original) throw new Error('Curadoria real ausente.');
const altered = parseCuration(JSON.parse(await readFile(process.env.QA_NEGATIVE_PAYLOAD, 'utf8')), run.artifacts);
const output = { ...original, id: randomUUID(), revision: 1, createdAt: new Date().toISOString(), payload: altered };
const result = await executeSpecialistTask({ role: 'output-validator', task: 'validate-output',
  model: models['output-validator'], signal: new AbortController().signal, timeoutMs: 120000,
  ...(config.piAuthPath ? { authPath: config.piAuthPath } : {}),
  prompt: JSON.stringify({ task: 'validation', artifacts: run.artifacts,
    objective: run.input.objective ?? '', output, previousVerdicts: [] }) });
await writeFile(process.env.QA_NEGATIVE_RESULT,
  JSON.stringify({ output, verdict: parseVerdict(result.payload), metadata: result.metadata }, null, 2),
  { mode: 0o600, flag: 'wx' });
JS
```

O parser aceitar o payload adulterado comprova apenas estrutura/fontes válidas.
O resultado esperado pela pessoa avaliadora é um parecer que detecte e localize a
alteração sem aprová-la. Registrar o parecer efetivo, inclusive eventual falsa
aprovação; uma resposta programada ou esta expectativa escrita não comprovam o
validador. Comparar depois da chamada, fora do contexto do modelo. Os ensaios
reais de 24/09/2026 e suas versões estão registrados em
[evidencias/t4.1](evidencias/t4.1/README.md); avaliação automatizada não substitui
a decisão da pessoa responsável pela frente C.

### Cancelamento, limites e recuperação da preparação

Durante `running`, “Cancelar preparação” persiste o cancelamento e aborta a sessão
ativa. Não apaga saídas/pareceres e não permite avanço por resposta tardia. Outro
rascunho só começa após o encerramento liberar o ambiente; não há fila. Repetir
`/start` retorna o processamento existente, sem reiniciar execução encerrada ou
seu orçamento. Após reinício, trabalho ativo fica interrompido, sem retomada.

Até dez histórias/requisitos, três produções/revisões automáticas por saída em
cada ciclo, duas tentativas técnicas do validador por revisão e 120 segundos por
chamada. Os **45 minutos ativos são cumulativos na execução**, sem espera humana.
Perguntas podem bloquear apenas uma regra da mesma história; o restante
independente continua. Sem trabalho elegível, a execução aguarda informação e
libera o ambiente. Casos estão disponíveis pelo roteiro T6.1 abaixo; navegador e
relatório permanecem pendentes.
Os comandos de container e o fluxo de publicação anteriores continuam aplicáveis.

### Responder e retomar a preparação

1. Abra a execução e confira a pergunta, seus requisitos/regras e a revisão.
   Escreva a decisão de negócio e salve a resposta (até 4.000 caracteres). A API
   recebe `{outputId, outputRevision, questionId, text}`, referentes à curadoria.
   O original permanece intacto; a resposta ganha autor, horário e fonte própria.
2. Confira a resposta salva. O estado muda para `awaiting_input/curation` e o plano
   anterior deixa de autorizar avanço. Use a ação de **retomar a preparação**
   quando estiver disponível; salvar respostas não chama os modelos. Ambiente
   ocupado ou configuração indisponível preserva a resposta para nova tentativa.
3. Acompanhe curadoria e plano revistos, com validações independentes. Confira
   se a resposta realmente resolveu a dúvida, compare a nova cobertura e aprove
   a nova versão somente após revisão humana. A aprovação anterior fica no
   histórico e não libera essa versão. Aprovar ainda não inicia criação de casos.

Repetir o envio da mesma pergunta/revisão com o mesmo texto não duplica o registro.
Texto diferente nessa referência é recusado com `ANSWER_CONFLICT`; não se edita
uma resposta salva neste recorte. Se a pergunta mudou, reconsulte a nova revisão
antes de responder. Uma resposta insuficiente pode gerar pergunta na revisão
seguinte. `/resume` exige resposta nova ainda não consumida e não reinicia execução
cancelada, interrompida ou com erro. Reinício do serviço não retoma automaticamente.

A retomada abre novo ciclo limitado de produção, conserva as chamadas anteriores,
mesmos IDs e revisões crescentes. Não zera os 45 minutos acumulados; esgotado o
limite, a retomada é recusada. O estado persistido informa o motivo.

Não há requisito de Gherkin: faltando esse formato, os agentes trabalham com o
comportamento descrito. Cenários novos são gerados na etapa T6.1 de casos. Não há
upload, parser completo de `.feature` nem executor Cucumber neste ajuste.
A avaliação das skills e seus limites estão em
[ajuste de entradas](evidencias/ajuste-entradas/README.md); a demonstração limpa
anterior de [T4.1](evidencias/t4.1/README.md) permanece como registro histórico,
sem comprovar por si só a versão atual das skills.

## Gerar e consultar casos lógicos — T6.1

Reutilize Node 24, pares `PI_PROVIDER`/`PI_MODEL` e substituições `PI_PLANNER_*` e
`PI_VALIDATOR_*` já configurados. Não há dependência, serviço, fila, credencial ou
modelo adicional. `test-designer` usa `create-test-plan` para o plano e
`create-test-cases` para os casos, escolhido internamente pelo backend. Cada tarefa
e validação abre sessão própria, sem ferramentas de navegador.

1. No detalhe da execução, confira curadoria e plano atuais aprovados pelo
   validador. Compare o plano com os originais e aprove a revisão exata. Essa
   decisão permanece salva sem iniciar inferência.
2. Clique em **Gerar casos de teste**. A interface envia somente `{outputId,
   outputRevision}` para `POST /api/runs/:id/continue`, com os controles existentes
   de sessão, `Origin` e identidade esperada. Primeiro aceite retorna `202`;
   repetição consulta o mesmo trabalho (`200`). Ambiente ocupado preserva a
   aprovação e permite tentar novamente; versão antiga exige reconsulta.
3. Acompanhe geração e validação no progresso. O conjunto exibido antes do parecer
   é **provisório**. Correções produzem nova revisão, conservando histórico e ID.
4. Expanda os casos para consultar referências, pré-condições, preparação, dados,
   técnicas, expectativa e fontes. Confira o aviso **Casos lógicos — percurso ainda
   não mapeado.** Não houve acesso à aplicação nem execução dos casos.
5. Após parecer `approved`, o estado é `awaiting_approval/case_design`. Recarregue
   para conferir persistência, revisão e parecer. A decisão humana sobre o conjunto
   validado é realizada pelo roteiro T6.2 abaixo.

## Aprovar ou solicitar alterações nos casos de teste — T6.2

Implementa a segunda aprovação humana exigida pelo fluxo do produto sobre o conjunto
de casos validado (`awaiting_approval/case_design`), antes de qualquer ação no navegador.

### Roteiro de operação pelo site

1. **Localizar e abrir a execução:** Entre na conta proprietária e acesse `/execucoes/:id`.
   Confira que a execução está em `Aguardando aprovação` na fase `Casos de teste`.
2. **Revisar o parecer independente:** No painel de casos de teste, confirme a revisão
   vigente e o parecer emitido por `output-validator` com `status: approved`. Os casos
   estão listados com dados, pré-condições, preparação, técnicas, expectativas e fontes.
3. **Aprovar os casos:**
   - Clique no botão **Aprovar casos de teste**.
   - A interface envia `{ outputId, outputRevision }` para `POST /api/runs/:id/approve`.
   - A confirmação é exibida imediatamente: *“Casos aprovados. O mapeamento ainda não foi iniciado.”*
   - O botão é removido da tela e a decisão permanece salva após recarregar a página, sair da conta e reiniciar o servidor.
4. **Solicitar alterações nos casos:**
   - Preencha o campo **Comentário sobre os casos** explicando o que precisa ser ajustado (por exemplo: `Revisar resultado esperado do caso CT-03.`). O comentário é obrigatório; o envio sem texto é bloqueado na interface e recusado pelo servidor com `400 / COMMENT_REQUIRED`.
   - Clique em **Solicitar alterações nos casos**.
   - A interface envia `{ outputId, outputRevision, comment }` para `POST /api/runs/:id/request-changes`.
   - A confirmação exibe: *“Alterações solicitadas. Os casos aguardam revisão.”*, junto do comentário, autor e data.

### Reencontrar a decisão

Ao reabrir a execução a qualquer momento, o histórico de aprovações da saída correspondente
é exibido no painel de casos. As decisões de plano e de casos são filtradas pelo seu
respectivo `outputId`, garantindo que decisões de casos não apareçam como aprovações do plano
e vice-versa.

### Recuperação de resposta incerta (falhas de conexão ou servidor)

Se houver queda de rede, resposta HTTP perdida ou erro transitório (500/503) durante o envio:
1. O texto do comentário digitado é **preservado intacto** no formulário da aba.
2. A interface informa: *“Não foi possível confirmar a decisão pela resposta. Consulte o registro salvo antes de decidir novamente; nenhuma decisão será reaplicada automaticamente.”*
3. O cliente **não reenvia automaticamente**: consulte a execução ou recarregue a página para verificar se a gravação atômica foi concluída no disco antes da falha de rede.
4. Se a decisão já tiver sido gravada, ela será carregada do servidor. Se não foi gravada, o usuário pode clicar novamente no botão sem perder o texto que havia digitado.

### Limites operacionais desta entrega

- **Sem início de navegador ou mapeamento:** Aprovar os casos de teste registra formalmente a autorização humana exigida pelo fluxo, mas **não inicia o navegador, não agenda tarefas de mapeamento (`mapping`) e não chama especialistas**. A interface informa a espera real.
- **Processamento automático de alterações fora do escopo:** Solicitar alterações grava o comentário de forma auditável e persistente. O processamento automático dessa alteração (como reavaliação de dependências pelo orquestrador ou refazer casos) fica expressamente fora deste card. O sistema não classifica o comentário por palavras-chave nem presume ações do orquestrador sem especificação e entrega próprias.
- **`/continue` exclusivo do plano:** O endpoint `/continue` permanece restrito à geração inicial de casos a partir do plano aprovado.

### Interrupções e limites dos casos

O máximo é 30 casos, três produções por saída/ciclo, duas tentativas técnicas do
validador por revisão e 120 s por chamada. Lista maior que 30 interrompe com pedido
de redução de escopo; nada é truncado. Os **45 minutos ativos da execução incluem
o tempo já usado em curadoria/plano**. Espera humana libera a reserva e não consome
esse tempo. Não há reinício automático de orçamento ou chamadas após falha.

Bloqueio e esgotamento apresentam motivo; parecer ausente ou inválido não aprova.
Cancelar aborta o processamento e conserva o que já foi confirmado. Resposta tardia
não publica casos nem restaura a execução cancelada. Reinício marca trabalho e
intenções pendentes como interrompidos, preserva histórico e não reinfere. Não edite
JSON persistido para forçar retomada ou aprovação. As intenções `create_cases`
conservam o vínculo do processamento e seu encerramento (`completed`, `interrupted`
ou `cancelled`). O regime de um escritor por ambiente continua aplicável.

### Verificação e demonstração controlada

Execute na raiz, com Node 24 no `PATH`:

```sh
npm run check
npm test
npm run build
CHROMIUM_PATH='<executável Chromium local>' npm run smoke:web
```

Use o procedimento de [smoke web](#jornada-pelo-navegador--t21) para o executável do
ambiente. O smoke agora percorre aprovação do plano → geração → progresso →
consulta de casos persistidos com respostas **simuladas**. Não faz chamada paga e
não comprova qualidade semântica do modelo.

Para inferência real, use as duas entradas públicas em
[evidencias/t6.1](evidencias/t6.1/README.md), em execuções separadas, e escreva/registre
as expectativas antes das chamadas. Cole somente a entrada, com objetivo vazio;
mantenha gabarito, resultados simulados e descrições de navegação fora do contexto.
Avalie depois as saídas da prosa e do Gherkin contra as fontes, incluindo dados e
justificativas de técnicas. Registre modelos, commit, revisões, pareceres e consumo
disponível. Identifique qualquer aprovação automatizada usada no ensaio; ela não
comprova revisão humana da frente C.

Faça ainda um ensaio independente do validador: copie o payload real de casos e
inverta uma expectativa material. Preserve os originais, respostas/fontes,
curadoria, plano e a revisão exata da cópia; use `role: output-validator`,
`task: validate-output`, a configuração existente e contexto completo da etapa.
O parser estrutural deve aceitar a cópia antes da chamada. Não envie a explicação
do defeito ao modelo. Registre o parecer efetivo, mesmo se aprovar indevidamente;
o ensaio não modifica o conjunto persistido da execução. Sanitização exclui
credenciais, cookies, contas, caminhos privados e sessões. Avaliação por agente e
inferência real devem ser distinguidas de revisão humana e testes simulados.

## Aplicação controlada de reservas — T7

### Configuração

O alvo é configurado por variáveis de ambiente:

```dotenv
DEMO_TARGET_PORT=4000        # Porta (padrão: 4000)
DEMO_TARGET_USER=demo        # Usuário (padrão: demo)
DEMO_TARGET_PASSWORD=demo1234 # Senha (padrão: demo1234)
DEMO_TARGET_MODE=reference   # reference | known-defect
```

Use somente conta descartável de demonstração. Um modo inválido impede a
inicialização com mensagem clara.

### Inicialização local

```sh
npm run demo:target
# ou com modo específico:
DEMO_TARGET_MODE=known-defect npm run demo:target
```

O servidor escuta em `http://127.0.0.1:4000` (loopback, porta configurável).
Abra essa URL no navegador.

### Inicialização no container

A pasta `scripts/` já é copiada pelo Dockerfile. Execute o alvo sem acrescentar
outro serviço permanente à VPS:

```sh
docker build --target runtime -t akcit-qa:ci .
docker run --rm --cpus=1 --memory=2g --shm-size=512m \
  --cap-drop=ALL --security-opt=no-new-privileges --read-only \
  --tmpfs /tmp:rw,size=512m,mode=1777 \
  --tmpfs /home/node:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  --tmpfs /data:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  -e DEMO_TARGET_MODE=reference \
  akcit-qa:ci node scripts/demo-target.mjs
```

No container, alvo e navegador compartilham `127.0.0.1`. Não presuma que
`localhost` do computador e `localhost` do container sejam o mesmo endereço.

### Troca de modo

Pare o processo e reinicie com `DEMO_TARGET_MODE=known-defect` ou
`DEMO_TARGET_MODE=reference`.

### Reset

Reiniciar o processo limpa sessões e reservas em memória. Este é o procedimento
de reset: não há banco ou persistência em disco.

### Encerramento

`Ctrl+C` ou `SIGTERM` encerra o servidor. No container, o Tini repassa o sinal.

### Smoke no navegador

```sh
CHROMIUM_PATH=/usr/bin/chromium SMOKE_ARTIFACT_DIR=artifacts/target npm run smoke:target
```

O smoke percorre login, navegação, formulários, ambos os modos, defeito
conhecido e reset. Verificações:

- Login incorreto e acesso direto a página protegida.
- Percurso completo: Login → Início → Reservas → Nova reserva → Confirmar → Lista.
- Ausência de reserva após rejeição.
- Preservação do comentário após recarregar a página, sem duplicar a reserva
  (POST redireciona com 303 para GET da lista).
- Defeito conhecido (qty=10) no modo `known-defect`.
- Reset com lista vazia e sessão anterior inválida.
- Acesso pelo Chromium da imagem do projeto.

### Configurar acesso ao alvo T7 em uma execução (T8.1)

Para vincular o alvo controlado T7 a uma execução criada no sistema:

1. **Habilitar a origem no ambiente:** certifique-se de que `http://127.0.0.1:4000` está em `TARGET_ALLOWED_ORIGINS`.
2. **Abrir a execução:** acesse `/execucoes/:id` pelo navegador.
3. **Preencher o painel "Acesso à aplicação testada":**
   - **URL inicial:** `http://127.0.0.1:4000`
   - **Perfil de acesso:** `Operador de reservas`
   - **Preparação necessária:** `Iniciar com a lista de reservas vazia.` (ou outra instrução de reset)
   - **Usuário da conta de teste:** `demo` (conforme `DEMO_TARGET_USER`)
   - **Senha da conta de teste:** `demo1234` (conforme `DEMO_TARGET_PASSWORD`)
   - **Autorização:** marcar a caixa *"Confirmo que tenho autorização para testar esta aplicação"*.
4. **Salvar acesso:** clique em *"Salvar acesso"*. O sistema responde com:
   > Acesso configurado. O login ainda não foi verificado pelo navegador.

#### Onde a credencial fica armazenada

- As credenciais do alvo são salvas em `DATA_DIR/runs/<runId>.json` (ou `/data/runs/<runId>.json` no container), no campo privado `targetCredential` do envelope `StoredRun`, fora do objeto público `run`.
- O objeto `run.input.credentialRef` armazena apenas um identificador opaco (`cred-<uuid>`).
- O arquivo possui permissão `0600` em diretório `0700`. A senha é mantida em texto simples no arquivo privado para que o executor automatizado (T8) possa realizar o login no navegador; a projeção pública da API (`GET /api/runs/:id`), os logs e o storage do navegador nunca expõem a senha ou o usuário.

#### Limitações do piloto

- Aceita apenas autenticação direta por usuário e senha (sem suporte a OAuth, autenticação em duas etapas, importação de cookies ou provedores de identidade corporativos).
- A URL inicial não aceita query string nem fragmento.
- A validação no salvamento é estática de formato e origem; salvar não abre o navegador nem verifica se as credenciais funcionam no alvo. A autenticação automatizada no navegador é de responsabilidade da etapa seguinte de mapeamento e execução (T8).

### Mapear e validar a navegação (T8.2)

Após as duas aprovações humanas (plano e casos) e o acesso configurado, a página da
execução oferece **Mapear aplicação**. O executor visual autentica pela interface e
percorre as telas relevantes; o validador visual examina o mapa e as capturas em
sessão independente; o mapa aprovado termina em `ready / mapping`.

#### Variáveis

| Variável | Papel | Valor do card |
| --- | --- | --- |
| `PI_EXECUTOR_PROVIDER` / `PI_EXECUTOR_MODEL` | Executor visual | `deepseek` / `deepseek-flash` |
| `PI_EXECUTOR_THINKING_LEVEL` | Executor visual | `high` (padrão do perfil) |
| `PI_VALIDATOR_VISUAL_PROVIDER` / `PI_VALIDATOR_VISUAL_MODEL` | Validador visual | `deepseek` / `deepseek-flash` |
| `PI_VALIDATOR_VISUAL_THINKING_LEVEL` | Validador visual | `high` (padrão do perfil) |
| `TARGET_ALLOWED_ORIGINS` | Destinos permitidos | origem exata do alvo (ex.: `http://127.0.0.1:4000`) |

Cada perfil exige o par provedor/modelo; ausência ou indisponibilidade recusa o
início com motivo (sem fallback silencioso). O validador textual continua em
`PI_VALIDATOR_*` (Pro/high).

#### Comandos

```bash
npm run smoke:mapping   # navegador/cursor/capturas/destinos reais com modelo substituído (imagem final)
node scripts/demo-target.mjs   # alvo T7 em http://127.0.0.1:4000 (modo reference)
npm test                 # inclui test/navigation.test.ts (contratos e transições)
```

#### Preparação do alvo e reprodução do ensaio real

1. Suba o alvo T7 (`node scripts/demo-target.mjs`, modo `reference`, credenciais `demo`/`demo1234`).
2. Configure `TARGET_ALLOWED_ORIGINS=http://127.0.0.1:4000` e os pares de
   perfil visual no `.env` do ambiente (local, dev ou produção).
3. No site, crie uma execução, prepare e aprove o plano, gere e aprove os casos.
4. Configure o acesso no painel (URL inicial `http://127.0.0.1:4000`, perfil, preparo,
   autorização e credencial `demo`/`demo1234`).
5. Clique em **Mapear aplicação**. Acompanhe o progresso: o executor explora e o
   validador visual emite o parecer. Ao final, o estado é `ready / mapping` com o
   texto *"Mapa validado — aguardando detalhamento dos percursos"*.
6. Confira no painel: telas com capturas, transições, caminhos, parecer do validador,
   pendências com casos afetados e limitações. As capturas são servidas por
   `GET /api/runs/:id/evidence/:assetId` (sessão + `X-Expected-User-Id` do
   proprietário; outra conta recebe 404).
7. Para o ensaio do validador, force uma transição sem suporte (ex.: remova a
   captura de destino antes da validação) e registre o parecer.

#### Ensaio real automatizado (T8.2-R1)

`npm run eval:mapping:real` executa o roteiro `scripts/eval-mapping-real.mjs`
**na imagem final**, com a composição normal do aplicativo (nenhuma substituição
de `modelCall`, `visualCall`, preflight, navegador ou pareceres), armazenamento
isolado e credenciais privadas do ambiente:

```bash
docker build --target runtime -t akcit-qa:ci .
mkdir -p artifacts/ensaio-real artifacts/human
docker run --rm --cpus=2 --memory=4g --shm-size=512m   --cap-drop=ALL --security-opt=no-new-privileges   --tmpfs /tmp:rw,size=1g,mode=1777   --tmpfs /home/node:rw,size=128m,uid=1000,gid=1000,mode=0700   --tmpfs /data:rw,size=256m,uid=1000,gid=1000,mode=0700   -v "$PWD/.data/pi:/data/pi:ro"   -v "$PWD/artifacts/ensaio-real:/evidence"   -v "$PWD/artifacts/human:/human"   -e PI_CODING_AGENT_DIR=/data/pi   -e DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"   -e DATA_DIR=/data/eval -e EVAL_EVIDENCE_DIR=/evidence -e EVAL_HUMAN_DIR=/human   -e APP_REVISION="$(git rev-parse HEAD)"   akcit-qa:ci node scripts/eval-mapping-real.mjs --run
```

O roteiro força os perfis documentados (curador `deepseek-flash/low`; projetista
e validador textual `deepseek-v4-pro/high`; executor e validador visual
`deepseek-flash/high`), sem fallback silencioso, e executa:

1. **Jornada completa pela interface com revisão humana:** o roteiro imprime o
   plano e os casos em `artifacts/human/awaiting-*.json` e aguarda a decisão do
   operador em `artifacts/human/decision-*.json` (`{"decision": "approved"}` ou
   `"changes_requested"`). Sem decisão registrada, a jornada falha com motivo.
2. **Jornada completa com aprovações automatizadas** (registrada como tal no relatório).
3. **Credencial inválida e correção** pelo fluxo suportado.
4. **Controles positivo e negativo do validador** a partir do mapa real.

As evidências (registros sanitizados, capturas, pareceres, chamadas, consumo e
`report.json`) ficam em `artifacts/ensaio-real/`; o relato humano fica em
[docs/evidencias/t8.2/ensaio-real.md](evidencias/t8.2/ensaio-real.md). O gabarito
não entra no contexto dos agentes; ele serve apenas à avaliação externa.

#### Limites

- Três produções/revisões do mapa e duas tentativas técnicas de validação por revisão.
- Cem ações de exploração por execução (**capturas não consomem ações**; a
  observação final segura continua disponível com os cliques esgotados) e
  45 minutos ativos acumulados (compartilhados com a preparação; sem reinício a
  cada correção e sem contar espera humana).
- 120 segundos por chamada de modelo; todas as chamadas são registradas com
  início e término — erro, timeout, cancelamento e saída inválida preservam o
  histórico. Falhas técnicas e de navegador conservam a causa identificável; o
  esgotamento de revisões é reservado a saídas de modelo fora do contrato.
- Piloto simples: uma única aba; novas abas e destinos fora de
  `TARGET_ALLOWED_ORIGINS` são bloqueados com motivo legível.
- Erro de credencial antes da autenticação: corrija a credencial no painel (nova
  revisão de acesso) e use **Mapear aplicação (nova tentativa)**; histórico e tempo
  consumido são preservados.
- O validador recebe o manifesto ordenado das imagens; referências de trabalhos
  anteriores, ações com erro e aprovação contraditória de autenticação não
  liberam `ready`.

## Referências

- [SDK do Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Docker Compose em produção](https://docs.docker.com/compose/how-tos/production/)
- [Limites de ambientes por plano GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
