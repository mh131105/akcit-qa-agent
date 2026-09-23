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

O workflow de desenvolvimento testa a imagem antes do envio ao GHCR. A VPS confere
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
histórico de intenções de trabalho autorizado. Os diretórios usam modo `0700` e
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
a uma conta apenas porque alguém informou o mesmo e-mail. Este recorte não cria
execuções pela API e não realiza migração automática de proprietários.

Cadastro/login compartilham limite de dez tentativas por e-mail e trinta por
endereço de conexão em quinze minutos. O endereço é o da conexão direta, sem
confiar em `X-Forwarded-For`; participantes que chegam pelo mesmo relay podem
compartilhar esse limite. O excesso responde `429`. Não registre senhas, cookies
ou hashes para investigar problemas de acesso.

A jornada e os erros estão em
[API autenticada de revisão do plano — T3.2](requisitos/CONTRATOS.md#api-autenticada-de-revisão-do-plano--t32).
Com Node.js 24, execute `node --import tsx --test test/authenticated-api.test.ts`
para reproduzir a jornada HTTP com duas contas, arquivos temporários reais e
relógio controlado. Os dados sintéticos são preparados exclusivamente no teste;
nenhuma fixture é carregada pela aplicação.

## Referências

- [SDK do Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Docker Compose em produção](https://docs.docker.com/compose/how-tos/production/)
- [Limites de ambientes por plano GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
