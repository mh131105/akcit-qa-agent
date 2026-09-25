# T8.2-R1 — Revisão do PR #29: defeitos, reprodução, correção e testes de regressão

- **Branch revisada:** `feat/validated-navigation-map`.
- **SHA inicial revisado:** `14ca870` (não havia commits posteriores em `origin`).
- **SHA do candidato corrigido:** ver [ensaio-real.md](ensaio-real.md) (o candidato final é o
  mesmo commit registrado lá; esta revisão evoluiu em commits na própria branch).
- **Imagem final validada:** construída do código versionado (`docker build --target runtime`),
  executada com o usuário `node` e as restrições do CI (`--cap-drop=ALL --read-only`, tmpfs).

Cada defeito abaixo foi reproduzido antes da correção e coberto por teste de
regressão. Os testes de navegador chamam as ferramentas reais dentro da imagem
final; os testes determinísticos (limites, falhas, concorrência) usam relógios e
substituições explícitas sem tocar o componente sob verificação.

## 1. Build da imagem quebrado

- **Defeito:** o estágio de compilação copiava apenas `src/`; `tsc` não resolvia
  `../../agents/test-executor/tools/browser.mjs`, importado por `src/runtime/pi-visual.ts`.
- **Reprodução:** `npm run build` sem o diretório `agents/` presente no contexto
  (equivalente ao estágio do Dockerfile em `14ca870`):

  ```text
  src/runtime/pi-visual.ts(8,36): error TS2307: Cannot find module
  '../../agents/test-executor/tools/browser.mjs' or its corresponding type declarations.
  ```

  O mesmo efeito ocorria no container: `docker build --target runtime` falhava na etapa `RUN npm run build`.
- **Correção:** `Dockerfile` copia `agents ./agents` antes da compilação; os arquivos
  necessários (`agents/`, `scripts/`, `dist/`, `src/web/`) continuam na imagem final.
  Sem declarações vazias, sem ignorar erros e sem depender de montagens da máquina
  do desenvolvedor. Arquivos novos passam a ser gravados com permissão `0644`
  (um arquivo `0600` quebrava a execução como usuário `node` na imagem).
- **Regressão:** build da imagem no CI + os quatro smokes executados na imagem
  (`smoke-runtime`, `smoke-web`, `smoke-target`, `smoke-mapping`).

## 2. Smoke de mapeamento sem autenticação real e com percurso curto

- **Defeito:** `scripts/smoke-mapping.mjs` usava `X-Expected-User-Id: smoke-owner`
  sem registrar conta nem enviar `Cookie`; as rotas de execução e de evidência
  respondem 401. A transição de login apontava para o `actionId` do preenchimento
  do usuário (`fill_credential`), não do clique em **Entrar**. O percurso terminava
  na tela inicial.
- **Reprodução:** execução do smoke na imagem final — a continuação recebia 401
  (`INVALID_SESSION`), e o mapa associaria `entrar` à ação de preenchimento.
- **Correção:** o smoke registra a conta pela API (padrão de `test/navigation.test.ts`),
  guarda cookie e ID retornados, usa esse proprietário na execução e nas aprovações
  sintéticas e envia `Cookie` + `X-Expected-User-Id` na continuidade, na consulta e na
  leitura das evidências. As recusas sem autenticação continuam verificadas (401).
  A transição `entrar` usa o `actionId` do clique em **Entrar** (verificado também no
  registro persistido: `tool: pointer`, `action: click`). O percurso vai até
  **Reservas → Nova reserva**, sem confirmar nenhuma reserva (`target.reservations` vazio).
  As respostas de modelo continuam identificadas como simulação.
- **Regressão:** checks do smoke — `conta-registrada-pela-api`,
  `recusas-sem-autenticacao`, `continuidade-202-repeticao-200`,
  `percurso-reservas-nova-reserva-sem-confirmar`, `mapa-validado-ready`,
  `evidencia-captura-real`, `segredo-fora-da-projecao`.

## 3. `smoke-web.mjs` nunca executável na jornada T8.2

- **Defeito:** o bloco de mapeamento referia `storedRecordAfter` (variável local de
  `preparationJourney`) e executava antes da própria jornada de preparação
  (`ReferenceError`). A verificação de evidência estrangeira usava o contexto do
  proprietário com o ID de outra conta, recebendo 409 `ACCOUNT_CHANGED` em vez de 404.
- **Reprodução:** `node scripts/smoke-web.mjs` na imagem em `14ca870` falhava em
  `storedRecordAfter is not defined`.
- **Correção:** `preparationJourney` devolve o snapshot com casos aprovados e o
  conjunto de casos; o bloco T8.2 foi movido para depois da jornada e usa esse
  snapshot; a evidência estrangeira é consultada com sessão própria da outra conta (404).
- **Regressão:** smoke-web verde, incluindo o check `T8.2: mapear aplicação pelo site …`.

## 4. Sessão de navegador: aba principal, limpeza e geometria

- **Defeitos em `agents/test-executor/tools/browser.mjs`:**
  - o bloqueio de novas abas era instalado antes da aba principal existir — a aba
    principal era fechada pelo próprio listener;
  - falha na inicialização (após `chromium.launch`) vazava o navegador;
  - a imagem vinha de `page.screenshot` (viewport) e o cursor operava no display X11:
    geometrias diferentes, compensadas por deslocamentos implícitos da barra do Chromium;
  - `fill_credential` digitava o segredo em qualquer foco;
  - a verificação de privacidade considerava a tela segura quando não havia campo
    `password`, e uma exceção da verificação liberava a captura;
  - `observe_screen` exigia ações restantes, impedindo a observação final segura
    quando os cliques acabavam.
- **Reprodução:** na imagem final — a aba principal era fechada logo após o `goto`;
  cliques medidos pela viewport erravam alvos abaixo da barra do navegador.
- **Correção:**
  - aba principal criada antes do listener de bloqueio;
  - limpeza em falha de inicialização (fecha o que foi aberto antes de propagar);
  - dimensões reais via `xdotool getdisplaygeometry` e captura do display X11 com o
    FFmpeg já usado em `smoke-runtime.mjs` (`x11grab`, sem deslocamento fixo);
    imagem e cursor passam a compartilhar a mesma geometria, e o smoke mede os
    pontos dos elementos na geometria do display (`screenX/screenY` + dimensões
    reais da janela, sem constante mágica);
  - `fill_credential` confere localmente o foco em campo compatível
    (`FOCUS_MISMATCH` recusa sem digitar nada);
  - credencial visível em texto ou em qualquer campo bloqueia a captura; falha da
    verificação também bloqueia — nenhuma imagem é salva nem enviada ao modelo;
  - capturas não consomem ações de interação: a observação final continua
    disponível com o teto de cliques esgotado.
- **Regressão:** smoke — `aba-principal-permanece-popup-bloqueado`,
  `cliques-alvos-pequenos-coordenadas-da-captura`, `foco-incorreto-recusado-sem-digitar`,
  `captura-insegura-bloqueada`, `captura-nao-consome-acao-limite-aplica-se-a-acoes`,
  `privacidade-indisponivel-bloqueia-captura`; skill de mapeamento orienta o uso da
  última observação segura durante o preenchimento privado.

## 5. Orçamento, cancelamento e registro de chamadas

- **Defeitos:**
  - `mappingEligibility` somava `accumulatedActiveMs` **e** o período encerrado
    (`finishedAt − startedAt`), contando o mesmo intervalo duas vezes;
  - o cancelamento não atravessava a inicialização do navegador nem as operações
    das ferramentas; processos em andamento não eram encerrados;
  - o histórico de chamadas só era persistido quando a sessão inteira retornava
    com sucesso — JSON inválido, erro, timeout ou cancelamento perdiam a chamada;
  - qualquer falha do executor (inclusive de navegador) virava novas revisões e,
    ao final, “limite de revisões esgotado”, sem a causa identificável.
- **Correção:**
  - `frozenActiveMs`: quando a preparação está encerrada, `accumulatedActiveMs` já
    contém o período encerrado; registros legados sem o campo calculam o período
    como compatibilidade; durante trabalho ativo soma-se apenas o período em
    andamento (espera humana nunca entra na soma);
  - `AbortSignal` propagado até `openBrowserSession` e às chamadas `exec`
    (xdotool/ffmpeg); `close()` aborta processos em andamento; a sessão é abortada,
    descartada e o navegador fechado antes de a reserva ser liberada;
  - cada inferência é persistida com início (`status: running`) e término,
    reutilizando `PreparationCall`; falha registra a chamada atual (`error`,
    `cancelled` ou `invalid`) e preserva as anteriores; saída fora do contrato
    marca as chamadas da tentativa como `invalid` com o código da falha;
  - somente saída inválida de modelo gera nova revisão; falhas técnicas e de
    navegador conservam a causa (`error` com o código original, ex.: `MODEL_ERROR`).
- **Regressão:** `test/navigation.test.ts` — orçamento (44 min permitem; 45 min
  impedem; espera humana não soma; legado calcula), falha de inferência com
  histórico preservado, saídas inválidas com três revisões e chamadas `invalid`;
  `test/pi-visual.test.ts` — cancelamento na inicialização do navegador e com
  sessão aberta, limpeza antes de liberar, teto de 120 s por chamada, contagem de
  todas as chamadas.

## 6. Contexto e validação do validador

- **Defeito:** o executor e o validador não recebiam explicitamente curadoria e
  plano; o validador não recebia identificação ordenada das imagens (só os anexos);
  ações com erro podiam sustentar transições; evidências anteriores à correção do
  acesso podiam comprovar a nova autenticação; e a combinação
  `authentication.status: not_authenticated` com parecer `approved` liberava `ready`.
- **Correção:**
  - executor e validador recebem `curation`, `plan` e `approvedCases` vigentes;
  - manifesto ordenado `{ observations: [{ imageIndex, observationId, assetId, at,
    width, height }] }` com ordem idêntica às imagens anexadas, além das ações das
    transições;
  - uma ação registrada com `outcome: error` não sustenta transição bem-sucedida
    (`ACTION_NOT_SUPPORTED`, nova revisão dentro do limite);
  - observações e ações carregam `mappingPreparationId` do trabalho que as criou;
    referências de trabalhos anteriores (ex.: antes da correção do acesso) são
    recusadas — a autenticação só é comprovada por evidência do trabalho vigente;
  - parecer `approved` com autenticação não concluída é registrado como validação
    inválida (`CONTRADICTORY_APPROVAL`) e consome as tentativas existentes; o
    caminho documentado de credencial recusada (`blocked` + `AUTHENTICATION_MISSING`
    → `awaiting_input` → correção do acesso → nova tentativa explícita) permanece.
  - O validador continua responsável pela avaliação semântica; essas verificações
    são determinísticas e apenas impedem estados e referências contraditórios.
- **Regressão:** `test/navigation.test.ts` — manifesto ordenado, contexto
  completo, aprovação contraditória (esgotamento e correção), ação com erro,
  evidências antigas recusadas.

## 7. Reinício e isolamento

- **Defeito:** não havia teste de reinício durante o mapeamento nem de recarga da
  execução pronta em novo processo.
- **Correção:** comportamento já implementado, agora coberto por regressão.
- **Regressão:** recarregar preserva mapa, parecer e evidências após novo login;
  reinício durante o trabalho marca `interrupted` (`SERVICE_RESTART`) sem conclusão
  nem retomada automática; após cancelamento, outra execução consegue reservar o
  ambiente; evidência isolada entre contas (404 com sessão própria).

## Resultado

- `npm run check` limpo; `npm test` **195/195** (11 novos em `test/navigation.test.ts`,
  7 em `test/pi-visual.test.ts`).
- Imagem final construída do código versionado; `smoke-runtime`, `smoke-target`,
  `smoke-web` e `smoke-mapping` executados na imagem com o usuário e as restrições
  do CI, todos `passed` (o smoke de mapeamento com 18 verificações de integração
  real de navegador/cursor/capturas).
- Ensaio com LLM real: [ensaio-real.md](ensaio-real.md).
- Pendências verdadeiras e resultados do card em [SPRINT.md](../../SPRINT.md).
