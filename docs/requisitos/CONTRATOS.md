# Contratos de integração v1

Base para implementar o [produto](PROTOTIPO.md), alinhada ao fluxo aprovado em
23/09/2026. São contratos propostos; esta documentação não significa que as APIs ou
agentes já estejam implementados. As seções de entregas implementadas delimitam
o comportamento disponível. O [exemplo sintético](exemplos/execucao-demo.json)
apoia os contratos e testes; a interface usa a API e não carrega exemplos.

## Fluxo e responsabilidades

```mermaid
flowchart TD
    I[Conta, aplicação, US e CA] --> C[Curadoria]
    C --> V1[Validador]
    V1 --> P[Plano de testes]
    P --> V2[Validador]
    V2 --> H1[Usuário aprova o plano]
    H1 --> T[Casos lógicos]
    T --> V3[Validador]
    V3 --> H2[Usuário aprova os casos]
    H2 --> M[Mapeamento pelo executor]
    M --> V4[Validador]
    V4 --> D[Planejador detalha os percursos]
    D --> V5[Validador e conferência dos campos preservados]
    V5 --> E[Executor realiza os casos]
    E --> V6[Validador revisa resultados e evidências]
    V6 --> R[Redator prepara relatório]
    R --> V7[Validador]
    V7 --> UI[Relatório no aplicativo e PDF]
```

As setas representam avanço após os controles da etapa. Correções retornam ao
produtor; bloqueios impedem seus dependentes. O detalhamento que muda a intenção do
caso retorna à criação e à aprovação de casos antes de executar.

O Pi é uma dependência do backend. Seus seis papéis são `orchestrator`,
`artifact-curator`, `test-designer`, `test-executor`, `report-writer` e
`output-validator`. O executor mapeia e testa em tarefas separadas. O usuário acessa
nosso site; o executor controla outro navegador, no ambiente de execução.

- **Especialistas:** produzem as saídas de cada etapa.
- **Validador:** em sessão própria, revisa qualidade e evidências; aprova, pede
  correção ou bloqueia. Recebe somente leitura, não altera saídas nem usa o cursor.
- **Usuário:** aprova cobertura do plano e situações, dados e expectativas dos casos.
- **Backend:** confere formatos, referências, limites, permissões e estados; salva
  versões e aplica os controles de avanço. Confere também o parecer do validador.
- **Orquestrador:** encaminha tarefas e aplica os controles, sem aprovar conteúdo.

## Objetos compartilhados

O backend define `ownerId` e `actorId` pela sessão autenticada; não aceita outro
proprietário ou autor indicado pelo cliente. IDs são estáveis dentro da execução.
Referências devem existir. Registros usam UTC;
a interface apresenta horário local. `requirement` corresponde à US e `rule` ao CA
ou regra complementar com origem. Esses nomes são mantidos para facilitar integração.

| Objeto | Campos essenciais |
| --- | --- |
| Execução (`run`) | `id`, `name`, `applicationName`, `ownerId`, `createdAt`, `status`, `phase`, `input`, `artifacts`, `outputs`, `validations`, `approvals`, `questions`, `answers`, `validationPolicy`, `budgetCycles` |
| Entrada (`input`) | `startUrl`, `credentialRef`, `accessProfile`, `dataPreparation`, `authorizedTarget`, `objective`, `artifactIds` |
| Artefato (`artifact`) | `id`, `name`, `version`, `text`; original preservado pelo backend |
| Origem (`source`) | `artifactId`, `locator`, `quote` |
| US (`requirement`) | `id`, `statement`, `rules`, `sources` |
| CA/regra (`rule`) | `id`, `statement`, `sources` |
| Plano (`testPlan`) | `objective`, `requirementIds`, `ruleIds`, `priorities`, `exclusions`, `approach`, `preconditions`, `sources` |
| Caso (`testCase`) | `id`, `requirementIds`, `ruleIds`, `preconditions`, `setup`, `pathId`, `data`, `techniques`, `expected`, `sources`; detalhado acrescenta `approvedCaseRevision` |
| Mapa (`navigation`) | `screens`, `transitions`, `paths` |
| Questão (`question`) | `id`, `description`, `requirementIds`, `caseIds`, `blocking`, `sources` |
| Resposta (`answer`) | `questionId`, `revision`, `actorId`, `at`, `text`, `affectedCaseIds` |
| Tentativa (`attempt`) | `id`, `status`, `verdict`, `setupObservation`, `events`, `observed`, `evidenceIds`, `evidenceGaps`, `reason` |
| Resultado (`result`) | `caseId`, `verdict`, `attempts`, `reason` |
| Evidência (`evidence`) | `id`, `caseId`, `attemptId`, `kind`, `capture`, `assetId`; intervalo para vídeo |
| Relatório (`report`) | `summary`, `limitations`, referências a casos, resultados e evidências |
| Saída (`output`) | `id`, `phase`, `producer`, `revision`, `budgetCycleId`, `dependsOn`, `answerRefs`, `payload` |
| Parecer (`validation`) | `id`, `outputId`, `outputRevision`, `validator`, `status`, `findings`, `reason` |
| Decisão humana (`approval`) | `id`, `outputId`, `outputRevision`, `actorId`, `at`, `decision`, `comment` |

Uma US com CA permite começar curadoria e planejamento. `startUrl` e `credentialRef`
podem ser `null`; perfil e preparo podem ficar pendentes. Completar e confirmar o
acesso é obrigatório antes do mapeamento. `objective` é opcional: o plano pode
derivar seu objetivo das US/CA, sem exigir que o usuário repita os documentos.

O backend resolve `credentialRef` em armazenamento privado. Senha, token e cookie
não aparecem em respostas, logs, artefatos ou contexto geral dos agentes. A captura
dos casos começa após autenticação. Somente o proprietário autenticado acessa as
execuções, mídias e PDF. Documentos e páginas são dados, nunca instruções para ampliar
permissões do agente. `authorizedTarget` registra a declaração de autorização do usuário;
a execução respeita o endereço e o escopo configurados. Essa declaração não substitui
a lista de destinos habilitados pela equipe, inclusive redirecionamentos, conforme RNF-05.

`source.locator` identifica página/seção de PDF ou linhas de texto; `quote` guarda o
trecho literal. Extração vazia ou PDF sem texto selecionável gera erro de entrada
legível. Curadoria preserva condições, exceções, limites e obrigatoriedade.

`priorities` lista `{ruleId, reason}`; `exclusions` lista `{description, reason}`.
Plano e casos recebem a curadoria validada **e as US/CA originais**. Cobertura deriva
das relações entre US, CA e casos: CA sem caso precisa de exclusão ou pendência
justificada. Cobertura planejada, cobertura executada e aprovação são medidas distintas.

## Saídas, versões e aprovações

| `phase` da saída | `payload` | Condição antes da etapa seguinte |
| --- | --- | --- |
| `curation` | `{requirements, questions}` | Validador aprova |
| `planning` | `{testPlan}` | Validador e usuário aprovam o plano |
| `case_design` | `{testCases}`; `pathId: null` | Validador e usuário aprovam os casos lógicos |
| `mapping` | `{navigation}` | Acesso confirmado; validador aprova o mapa |
| `route_detail` | `{testCases}` com caminho e `approvedCaseRevision` | Validador aprova e backend confere preservação dos campos aprovados |
| `execution` | `{results, evidence}` | Validador aprova as conclusões publicáveis |
| `report` | `{report}` | Validador aprova antes da publicação |

Toda saída é imutável. Uma correção mantém o `id` e cria outra `revision`, inteira a
partir de 1, crescente também entre ciclos de orçamento. `dependsOn` lista `{outputId, revision}` das saídas usadas; `answerRefs`
lista `{questionId, revision}` das respostas usadas. O backend preserva também a cópia
original dos artefatos. Os campos de consulta da API não substituem esses snapshots.

O validador recebe a revisão exata, as fontes originais sem segredos, dependências
aprovadas, respostas utilizadas, pareceres anteriores e evidências pertinentes.
Confere semântica da curadoria, cobertura e técnicas, percursos observados, suporte
às conclusões e fidelidade do relatório. Reprodução é solicitada ao executor; o
validador não reescreve resultados nem modifica a aplicação.

`validation.status` é `approved`, `changes_requested`, `blocked` ou `error`.
`findings` lista `{code, message, location}`; correção, bloqueio e erro exigem achado e
justificativa concreta. `location` identifica o campo/item, ou é `null` se geral.
Ausência de parecer, erro técnico ou parecer inválido nunca aprovam uma saída.
Cada revisão recebe no máximo um parecer de qualidade válido; tentativas técnicas
com `error` ficam registradas e permitem nova tentativa dentro do limite. Não há
validação recursiva do próprio validador: o backend confere a estrutura do parecer.

`run.approvals` registra decisões imutáveis para `planning` e `case_design`.
`decision` usa `approved` ou `changes_requested`; pedido de alteração exige comentário.
O backend exige parecer `approved` da mesma revisão antes de registrar decisão humana.
A interface informa claramente se o usuário está aprovando plano ou casos.
Uma decisão antiga nunca libera uma revisão nova.

Em `route_detail`, cada caso tem `approvedCaseRevision: {outputId, revision}` apontando
para o conjunto lógico aprovado. O backend compara IDs, escopo (`requirementIds`,
`ruleIds`), pré-condições, preparação (`setup`), dados, técnicas, expectativa e fontes
com aquele snapshot. Apenas `pathId` e a referência à aprovação são acrescentados.
Mudança material retorna a `case_design`, nova validação e aprovação humana; se afetar
o plano, este também é revisado. Não é necessário introduzir hash ou outro serviço.

Se uma dependência ou resposta mudar, suas saídas dependentes exigem nova revisão e
validação; aprovações humanas afetadas também são renovadas. Conteúdo histórico fica
consultável, identificado como desatualizado, e não autoriza execução futura.

**Parecer aprovado não significa teste aprovado.** Um defeito corretamente documentado
mantém `failed` enquanto a saída recebe `approved`. O mesmo vale para bloqueios e
incertezas classificados corretamente. O validador não substitui evidência por uma
estimativa de confiança.

## Controle implementado da aprovação do plano — T1.1

O módulo [`src/domain/plan-approval.ts`](../../src/domain/plan-approval.ts) implementa
somente o controle entre a revisão humana do plano e a solicitação de trabalho.
**Aprovar registra uma decisão; continuar é uma operação separada.** O controle
atende parcialmente RF-09, RF-14, RN-04, RN-05, RN-06 e RN-12 e não substitui as
demais etapas do produto.

```ts
applyPlanApprovalCommand(
  state: PlanApprovalState,
  command: PlanApprovalCommand,
): PlanApprovalResult
```

A função é pura e determinística: não altera a entrada, não lê relógio, não persiste
dados e não chama modelos, agentes ou rede. O chamador fornece estes campos de
`PlanApprovalState`, todos tratados como somente leitura:

| Campo | Formato e origem |
| --- | --- |
| `status`, `phase` | Strings do estado salvo da execução; somente `awaiting_approval` e `planning` aceitam comandos |
| `plan` | Snapshot vigente `{id, revision, dependsOn: [{outputId, revision}]}`, ou `null` |
| `curation` | Snapshot vigente `{id, revision}`, ou `null` |
| `validations` | Lista de `{outputId, outputRevision, validator, status}`; usa os estados de parecer definidos acima |
| `approvals` | Histórico de `{id, outputId, outputRevision, actorId, at, decision, comment}`; `decision` é `approved` ou `changes_requested` |

O backend obtém os snapshots vigentes e seu histórico no armazenamento. Modelo e
navegador do usuário não escolhem qual revisão é vigente. Este recorte aceita
exatamente uma dependência do plano: a referência ao ID e revisão da curadoria vigente.
Dependência ausente, adicional ou divergente impede o comando. Todas as revisões
conferidas devem ser inteiros positivos seguros em JavaScript. O backend continua
responsável por invalidar saídas quando artefatos ou respostas mudarem; este módulo
não percorre `answerRefs` nem o grafo completo de dependências.

Plano e curadoria precisam, cada um, de exatamente um parecer de qualidade da revisão
vigente emitido por `output-validator`, com `status: approved`. Pareceres de outros
papéis ou revisões não autorizam a operação. Tentativas técnicas com `error` são
preservadas e ignoradas na contagem de pareceres de qualidade; somente erros, ausência,
rejeição (`changes_requested`), bloqueio ou mais de um parecer de qualidade impedem
a operação.

`PlanApprovalCommand` é a união de somente três comandos. Todos contêm `outputId`
e `outputRevision` esperados pelo solicitante, conferidos contra o plano vigente:

| `type` | Outros campos e condições | Efeito de sucesso |
| --- | --- | --- |
| `approve_plan` | `id`, `actorId`, `at`; `comment` opcional; plano e curadoria vigentes e validados | Acrescenta decisão `approved`; mantém `planning` / `awaiting_approval`; `work: null` |
| `request_plan_changes` | `id`, `actorId`, `at`; `comment` obrigatório e não composto apenas por espaços; plano e curadoria vigentes e validados | Acrescenta decisão `changes_requested`; mantém `planning` / `awaiting_approval`; `work: null` |
| `continue` | `resourceReserved: boolean`; reconfere versões, pareceres e decisão humana válida da mesma revisão | Com reserva e decisão `approved`: `case_design` / `running`, intenção `create_cases`; com reserva e `changes_requested`: `planning` / `running`, intenção `analyze_feedback` |

Nos comandos de decisão, `id` identifica o registro, `actorId` identifica o autor e
`at` informa uma data/hora UTC real em `YYYY-MM-DDTHH:mm:ssZ` ou
`YYYY-MM-DDTHH:mm:ss.sssZ`. Os três campos devem ser não vazios. Comentário omitido
vira `''`; comentários informados são strings preservadas literalmente.
`analyze_feedback` encaminha a análise do pedido: especialista
e validador ainda avaliarão quais saídas e aprovações precisam ser revistas. Não
significa refazer automaticamente somente o plano.

O retorno discriminado contém sempre o estado e a intenção:

```ts
type PlanApprovalResult =
  | { ok: true; state: PlanApprovalState; work: null | {
      type: 'create_cases' | 'analyze_feedback';
      outputId: string; outputRevision: number;
    } }
  | { ok: false; state: PlanApprovalState; work: null; error: {
      code: PlanApprovalErrorCode; message: string;
    } };
```

Todo erro devolve o mesmo objeto `state` recebido, integralmente preservado, e
`work: null`. `error.code` é estável para integração; `error.message` explica o motivo
à pessoa. A indisponibilidade do recurso também é um erro sem alteração de estado.

| Código | Motivo |
| --- | --- |
| `INVALID_STATE` | Comando desconhecido ou execução fora de `planning` / `awaiting_approval`, inclusive `running`, `cancelled`, `completed`, `interrupted` ou `error` |
| `INVALID_DECISION` | Registro de decisão novo ou anterior sem identificador, autor ou horário UTC válido, ou comentário que não seja string; uma repetição não confirma uma decisão anterior inválida |
| `STALE_VERSION` | Plano, curadoria ou referência ausente, inválida ou desatualizada; revisão inválida; plano e curadoria com o mesmo ID; dependência não atendida pelo recorte |
| `INSUFFICIENT_VALIDATION` | Plano ou curadoria sem o parecer único e aprovado exigido para a revisão vigente |
| `DECISION_MISSING` | Continuidade sem decisão humana válida para a revisão vigente |
| `DECISION_CONFLICT` | Decisão diferente já registrada para a revisão; múltiplas decisões nessa revisão; identificador já utilizado por outra decisão |
| `COMMENT_REQUIRED` | Pedido de alteração sem comentário não vazio |
| `RESOURCE_UNAVAILABLE` | Continuidade sem reserva do ambiente; decisão e espera permanecem registradas |

A repetição compara revisão, autor, decisão e comentário literal. Se o conteúdo for
idêntico, a decisão anterior for válida e a revisão ainda estiver vigente e validada,
devolve sucesso sem acrescentar registro, preservando o ID e horário originais; um novo `id` ou `at` recebido não
transforma a repetição em outra decisão. Conteúdo ou autor diferente gera conflito;
não há edição retroativa. Revisões antigas e suas decisões ficam no histórico; uma
nova revisão exige novo parecer e nova decisão. Repetir `continue` depois do avanço
retorna `INVALID_STATE`, sem produzir outra intenção.

Se a decisão anterior tiver horário inválido, a repetição retorna `INVALID_DECISION`,
preserva integralmente o registro recebido e mantém `work: null`; não corrige a data
automaticamente. A correção de T3.2 não muda as regras de `continue`.

Exemplo com `state` preparado em `planning` / `awaiting_approval`, plano
`out-planning` revisão 1, plano e curadoria vigentes validados e nenhuma decisão:

```ts
const approved = applyPlanApprovalCommand(state, {
  type: 'approve_plan', outputId: 'out-planning', outputRevision: 1,
  id: 'approval-1', actorId: 'user-1', at: '2026-09-23T16:00:00Z',
}); // ok: true; awaiting_approval; work: null
const busy = applyPlanApprovalCommand(approved.state, {
  type: 'continue', outputId: 'out-planning', outputRevision: 1,
  resourceReserved: false,
}); // ok: false; RESOURCE_UNAVAILABLE; aprovação preservada; work: null
const started = applyPlanApprovalCommand(busy.state, {
  type: 'continue', outputId: 'out-planning', outputRevision: 1,
  resourceReserved: true,
}); // ok: true; running / case_design; work.type: create_cases
```

Na integração, o backend deve conferir autenticação e propriedade da execução,
definir autor e horário confiáveis e validar os dados recebidos. Decisões são salvas
sem exigir disponibilidade do ambiente. Para continuar, o backend obtém a reserva,
aplica o comando sobre estado atualizado e persiste a transição antes de despachar a
intenção ao especialista. Deve impedir transições concorrentes, liberar a reserva em
recusas e tratar falhas de persistência ou despacho sem perder a decisão nem duplicar
trabalho. Falha após persistir precisa de recuperação explícita do trabalho pendente;
repetir este comando sobre `running` não faz um novo despacho.

`resourceReserved: true` representa uma reserva já obtida pelo backend; não implementa
exclusão mútua nem prova uma reserva quando enviado pelo navegador. Esta entrega não
inclui persistência, autenticação, concorrência real, recuperação ou execução de
agentes. API/persistência (T3) e orquestração (T4) integrarão esses controles. Os testes
em [`test/plan-approval.test.ts`](../../test/plan-approval.test.ts) usam curadoria,
plano e pareceres **sintéticos** do exemplo, sem chamadas pagas ou dependência da VPS.

## Persistência da aprovação do plano — T3.1

[`src/storage/runs.ts`](../../src/storage/runs.ts) e
[`src/application/plan-approval.ts`](../../src/application/plan-approval.ts) integram
o domínio de T1.1 ao disco. Cobrem parcialmente RF-08, RF-14, RN-05, RN-06 e RNF-06.
O domínio e seus testes permanecem inalterados.

### Registro físico

Cada execução ocupa `config.dataDir/runs/<runId>.json`; `DATA_DIR` configura a raiz,
que corresponde a `/data` no volume persistente do container:

```ts
type StoredRun = {
  schemaVersion: 1;
  run: RunRecord; // Registro completo, com os campos do contrato e campos adicionais.
  workIntents: WorkIntent[];
};
type WorkIntent = {
  id: string; // UUID gerado pelo backend.
  type: 'create_cases' | 'analyze_feedback';
  outputId: string;
  outputRevision: number;
  createdAt: string; // UTC, YYYY-MM-DDTHH:mm:ss.sssZ.
  status: 'pending' | 'interrupted';
  interruption?: { reason: 'service_restart'; at: string }; // Obrigatório se interrupted.
};
```

`run` conserva identificação, proprietário, entradas, artefatos, conteúdo das
saídas, versões, pareceres, aprovações, perguntas, respostas, política, ciclos e
campos adicionais. `input.credentialRef` é string ou `null`; o serviço não resolve
essa referência nem copia segredos para o registro. Conteúdo de documentos e
saídas é dado, não instrução. A leitura confere envelope, identificação, estrutura
dos campos utilizados e intenções; não valida semanticamente todos os payloads.
Não há conversão automática de schema, nem substituição de dados inválidos por
uma execução vazia. As regras de aprovação continuam exclusivamente no domínio.

`RunStore(dataDir)` oferece `initialize()`, `create(run)`, `read(runId)`,
`update(runId, change)` e `recoverInterrupted()`. A criação devolve o envelope
salvo com intenções vazias e recusa um ID existente, mesmo que o arquivo esteja
inválido. A leitura devolve o envelope completo. Não há cache nem descritores
mantidos abertos: outra instância lê os mesmos dados e não é necessário `close()`.
IDs aceitam de 1 a 128 caracteres ASCII alfanuméricos, `_` e `-`, começando por
alfanumérico. Separadores, pontos e tentativas de sair do diretório são recusados
antes da formação de caminhos. Diretórios usam `0700`, arquivos novos `0600`;
a leitura recusa links simbólicos no arquivo da execução.

### Serviço interno

```ts
executePlanCommand(
  store: RunStore, // Inicializado com config.dataDir.
  runId: string,
  request: Readonly<{
    type: 'approve_plan' | 'request_plan_changes' | 'continue';
    outputId: string;
    outputRevision: number;
    comment?: string;
  }>,
  context: Readonly<{ userId: string; resourceReserved?: boolean }>,
): Promise<PlanCommandResult>
```

O solicitante escolhe somente comando, referência esperada e comentário. A
identidade `context.userId` é fornecida pelo backend e precisa corresponder a
`ownerId`; não representa autenticação implementada. Apenas
`context.resourceReserved === true` confirma reserva já obtida pelo chamador
interno. Omissão significa recurso indisponível. UUID e horário UTC da decisão e
da intenção são gerados pelo serviço. Campos extras de autoria, tempo, parecer,
estado ou reserva no request não são usados para construir o comando.

O resultado é `{ok: true, status, phase, approvals, work}`, em que `approvals`
contém o histórico de decisões salvo e `work` é a nova intenção persistida ou
`null`. Não há despacho. Recusas retornam somente
`{ok: false, work: null, error: {code, message}}`, sem execução ou projeção; mensagens
de armazenamento são fixas e não expõem documentos, caminhos ou credenciais.

Dentro da trava compartilhada pelo processo, a operação:

1. Relê o registro do disco e confere o proprietário.
2. Seleciona plano e curadoria por `phase`, exigindo um único ID lógico por saída
   e revisões sem duplicatas. A vigente é a maior revisão do mesmo ID,
   independentemente da ordem do array e de quais revisões foram aprovadas.
   Revisão numérica inválida não é ignorada em favor de uma válida: o domínio
   recebe essa versão e a recusa. Saída ausente vira `null` na projeção.
3. Monta `PlanApprovalState` com versões, estado, pareceres e decisões salvos;
   constrói o comando e chama `applyPlanApprovalCommand`.
4. Em recusa, não grava. Em sucesso, altera somente `run.status`, `run.phase` e
   acrescenta as decisões novas; registra a intenção retornada no mesmo envelope.
   Nunca substitui a execução completa pela projeção `result.state`.
5. Escreve o envelope completo em temporário exclusivo no mesmo diretório,
   sincroniza e fecha o arquivo, renomeia sobre o definitivo, sincroniza o
   diretório e então confirma.
   Falha antes da substituição conserva o arquivo anterior e não confirma trabalho.

Se a renomeação ocorrer mas a sincronização do diretório falhar, o retorno ainda
será erro; o registro pode já estar salvo e deve ser relido. Isso não autoriza
despachar trabalho presumindo sucesso nem repetir a intenção fora deste serviço.

`update<T>` recebe uma função `(record: StoredRun) => {value: T, save: boolean}`
(também pode ser assíncrona). O callback altera o registro recém-lido e indica
`save: true` para persistir; `false` descarta qualquer mudança local. `value` só é
devolvido depois da gravação solicitada. A trava cobre **ler → aplicar → salvar**,
é compartilhada entre instâncias de `RunStore` e também protege a criação.
Todo futuro escritor, inclusive cancelamento, deve usar esse caminho. Callbacks
não podem chamar `update`/`create` recursivamente: a trava não é reentrante.
A implantação pressupõe **um único processo escritor por ambiente**; a trava
não coordena processos e não reserva o navegador.

### Erros, repetição e reinício

Os códigos do domínio listados em T1.1 são preservados. O serviço acrescenta:

| Código | Comportamento |
| --- | --- |
| `INVALID_RUN_ID` | Recusa ID inseguro antes de construir o caminho |
| `RUN_NOT_FOUND` | Registro inexistente |
| `RUN_INACCESSIBLE` | Registro inacessível ou arquivo não regular/link simbólico |
| `RUN_EXISTS` | Criação recusada sem sobrescrever |
| `INVALID_RECORD` | JSON, envelope ou estrutura inválidos; arquivo preservado |
| `STORAGE_FAILURE` | Falha ao concluir a operação de armazenamento; nenhum sucesso confirmado |
| `UNAUTHORIZED` | Contexto sem usuário válido ou usuário diferente do proprietário; nenhum dado da execução devolvido |
| `AMBIGUOUS_RECORD` | Mais de um ID de plano/curadoria ou revisão duplicada nessa saída |

Decisões idênticas repetidas, inclusive concorrentes, mantêm UUID e horário
originais e não regravam o arquivo. Decisões conflitantes recebem
`DECISION_CONFLICT`, sem sobrescrever a vencedora. Duas continuidades concorrentes
produzem um sucesso e um `INVALID_STATE`, com apenas uma intenção salva junto da
transição. Repetir a continuidade após o avanço também é `INVALID_STATE`, conforme
o domínio. Sem reserva, `RESOURCE_UNAVAILABLE` mantém a decisão e a espera, sem
intenção. Aprovar e pedir alteração não exigem reserva.

Antes de devolver o servidor em `createApp`, `recoverInterrupted()` lê os JSONs e
usa `update` para mudar cada execução `running` para `interrupted`. Acrescenta
`{reason: 'service_restart', at: <UTC>}` ao histórico `run.interruptions` e marca
cada intenção `pending` dessa execução como `interrupted`, com o mesmo evento em
`work.interruption`. Intenções já interrompidas, decisões e conteúdo permanecem.
A recuperação retorna a quantidade de execuções alteradas; repeti-la não muda
horários nem acrescenta eventos. Rascunhos, esperas humanas e estados encerrados
ficam intactos. JSON inválido ou falha de recuperação impede disponibilizar o
servidor, sem apagar o registro. A recuperação é por execução: registros já
recuperados continuam válidos se outro arquivo falhar; nova tentativa é segura.
Temporários `.tmp` de uma queda são ignorados, nunca promovidos automaticamente.

Exemplo interno, com uma execução sintética previamente criada em espera e com
plano/curadoria vigentes validados:

```ts
const store = new RunStore(config.dataDir);
await store.initialize();
const reference = { outputId: 'out-planning', outputRevision: 1 };
const context = { userId: 'user-demo' };
const approved = await executePlanCommand(store, 'run-demo-001', {
  type: 'approve_plan', ...reference,
}, context);
if (!approved.ok) throw new Error(approved.error.code);

const reopened = new RunStore(config.dataDir);
await reopened.initialize();
const saved = await reopened.read('run-demo-001'); // Mesma decisão, UUID e horário.
// A orquestração obtém a reserva real antes desta chamada:
const continued = await executePlanCommand(reopened, saved.run.id, {
  type: 'continue', ...reference,
}, { ...context, resourceReserved: true });
if (!continued.ok) throw new Error(continued.error.code);
const pending = (await reopened.read(saved.run.id)).workIntents; // Uma create_cases.
```

Os testes em [`test/plan-approval-storage.test.ts`](../../test/plan-approval-storage.test.ts)
usam arquivos reais temporários e cópia do exemplo sintético; a aplicação não
carrega esse exemplo. Página inicial e healthcheck conservam o comportamento.
**Limites:** sem API, autenticação implementada, reserva real, agendamento, consumo
de intenções, Pi ou execução dos especialistas. T3 e T4 permanecem abertas.
Intenção única não prova execução de agente exatamente uma vez. A orquestração
ainda precisa tratar reserva, recusas, falhas e recuperação explícita do trabalho.

## API autenticada de revisão do plano — T3.2

T3.2 acrescentou as sete operações abaixo a
[`src/http/api.ts`](../../src/http/api.ts), sobre o servidor `node:http`.
[`src/auth.ts`](../../src/auth.ts) fornece a identidade confiável para o serviço
de T3.1. O recorte cobre parcialmente RF-08, RF-10, RF-14, RN-05, RNF-04 e RNF-06.
Criação textual e histórico são acrescentados por T3.3, documentada adiante.
Upload, reserva de navegador e agentes continuam pendentes. Não há rota
`/continue`; continuidade e despacho permanecem em T4.

### Operações e entradas

| Método e rota | JSON de entrada | Sucesso |
| --- | --- | --- |
| `POST /api/auth/register` | `{name, email, password, teamName?}` | `201`, `{user}`, inicia sessão |
| `POST /api/auth/login` | `{email, password}` | `200`, `{user}`, inicia nova sessão |
| `POST /api/auth/logout` | `{}` | `204`, sem corpo; invalida sessão e limpa cookie |
| `GET /api/auth/me` | Sem corpo; cookie de sessão | `200`, `{user}` |
| `GET /api/runs/:id` | Sem corpo; cookie de sessão | `200`, consulta pública descrita abaixo |
| `POST /api/runs/:id/approve` | `{outputId, outputRevision}` | `200`, `{status, phase, approvals}` |
| `POST /api/runs/:id/request-changes` | `{outputId, outputRevision, comment}` | `200`, `{status, phase, approvals}` |

`user` contém somente `id`, `name`, `email` e `teamName`. O ID interno é gerado pelo
backend. Nome e equipe têm de 1 a 120 caracteres após remoção de espaços externos;
equipe é opcional. E-mail tem no máximo 254 caracteres e é normalizado com remoção
de espaços externos e conversão para minúsculas, inclusive na configuração.
Senha tem de 15 a 128 caracteres Unicode, sem remoção de espaços ou truncamento.
`outputId` tem de 1 a 128 caracteres e não pode conter apenas espaços;
`outputRevision` é inteiro positivo seguro. `comment` tem de 1 a 4.000 caracteres,
não pode conter apenas espaços e é preservado literalmente.

Todo POST exige `Content-Type: application/json`, corpo JSON objeto e `Origin`
exatamente igual a `APP_ORIGIN`. Origem ausente, `null`, diferente, ou coincidência
apenas de prefixo/sufixo é recusada. São conferidos protocolo, host e porta da origem
completa configurada, sem confiar em `Host`, `X-Forwarded-Host` ou outro cabeçalho
para descobrir a origem permitida. Não há CORS para outras origens.
O limite de corpo é **16 KiB**, conferido também durante recebimento em partes.
JSON inválido, arrays, `null`, tipos incorretos e campos extras são recusados,
inclusive `actorId`, `at`, `status`, `validations` e `resourceReserved`.
Todas as respostas da API, inclusive erros, têm `Cache-Control: no-store`.

### Precondição de conta esperada

Todas as operações de `/api/runs` e `/api/runs/:id`, incluindo histórico,
consulta e decisões, e `POST /api/auth/logout` exigem `X-Expected-User-Id`.
Cadastro, login e `GET /api/auth/me` dispensam esse cabeçalho.
O cliente envia o ID da conta para a qual preparou a operação: um único UUID v4,
no formato dos IDs gerados para as contas, com hífens (`8-4-4-4-12`) e comparação
sem distinguir maiúsculas/minúsculas. Cabeçalhos repetidos, inclusive iguais,
são recusados usando `headersDistinct`; valores
concatenados também são inválidos.

`handleApi` confere essa precondição em um único ponto, depois de autenticar a
requisição e antes de ler ou alterar execuções ou encerrar a sessão:

| Cabeçalho | Resultado |
| --- | --- |
| Ausente, repetido ou fora do formato | `400 / INVALID_EXPECTED_USER_ID` |
| UUID válido diferente do ID autenticado | `409 / ACCOUNT_CHANGED` |
| ID igual ao autenticado | Prossegue com as verificações existentes |

O cabeçalho é **uma precondição, não uma autorização**. `ownerId` e `actorId`
continuam vindo exclusivamente da sessão. Na divergência, a API não acessa
execuções, não encerra a sessão atual e não revela IDs de contas ou dados privados.
Consultar `/auth/me` antes do envio não substitui a precondição: outra aba pode
trocar o cookie entre a consulta e a operação.

### Identidade, senha e sessão

`APP_ORIGIN` é a origem exata usada pelo navegador, com protocolo e porta quando
necessária, sem caminho, credenciais, consulta ou fragmento. HTTPS é aceito; HTTP
é restrito a loopback para uso local ou túnel. Origem inválida impede carregar a
configuração. Origem ausente mantém o healthcheck disponível, mas autenticação
responde `503`, informando a configuração pendente.
`PILOT_ALLOWED_EMAILS` é a lista separada por vírgulas de e-mails habilitados.
Cadastro e login exigem participação na lista; removê-la revoga o acesso da conta.
Lista vazia desabilita acesso por contas; a lista não verifica titularidade de e-mail.

As contas são persistidas em `DATA_DIR/auth/users.json`, envelope
`{schemaVersion: 1, users: [...]}`, com
ID interno, nome, e-mail normalizado, equipe opcional, criação UTC e dados do hash.
Cadastro serializa **ler → verificar unicidade → gravar**, com arquivo temporário,
sincronização e renomeação atômica, diretório `0700` e arquivo `0600`. Cadastros
concorrentes não duplicam e-mail nem removem contas. O armazenamento exige um único
processo escritor por ambiente, como o de execuções.

Senha usa `crypto.scrypt` assíncrono com salt aleatório de 16 bytes, chave de
64 bytes, `N=32768`, `r=8`, `p=3` e `maxmem=64 MiB`. Algoritmo, parâmetros, salt e
hash são salvos; a verificação usa `timingSafeEqual`. Os parâmetros seguem as
[configurações scrypt da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)
e a [API assíncrona do Node.js 24](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
Senha, hash e cookie não são registrados em logs nem devolvidos em JSON.

Cada cadastro ou login bem-sucedido gera token aleatório novo de 32 bytes;
identificadores de sessão fornecidos pelo cliente não são adotados. A sessão fica
somente em memória, com validade absoluta de **oito horas**. O cookie `akcit_session`
usa `HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`, sem `Domain`, e `Secure` quando `APP_ORIGIN` usa
HTTPS. Logout invalida a sessão e expira o cookie. Reinício exige novo login e
preserva contas, execuções e decisões. As proteções de cookie e origem seguem as
orientações da OWASP para
[sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
e [origem em APIs](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#using-standard-headers-to-verify-origin).

Cadastro e login compartilham limite de **dez tentativas por e-mail** e **trinta
por endereço de conexão em quinze minutos**, com `429` no excesso. O endereço vem
da conexão; `X-Forwarded-For` não é confiável neste recorte. Contadores vencidos
são removidos; o teto é de 10.000 chaves combinando e-mails e endereços. Saturação
recusa novas chaves com `429` até a expiração de contadores. Login incorreto usa mensagem
genérica, sem distinguir e-mail inexistente de senha incorreta.

### Consulta pública e decisão

`getPlanReview(store, runId, {userId})` carrega a execução, confere seu `ownerId`
contra o ID da sessão e reutiliza a seleção de revisões de T3.1. A consulta retorna
somente os campos abaixo; o envelope `StoredRun` nunca é serializado na resposta.

| Campo | Conteúdo público |
| --- | --- |
| `id`, `name`, `applicationName`, `createdAt`, `status`, `phase` | Identificação e estado da execução |
| `plan` | `null` se não há plano; caso contrário `{id, revision, payload: {testPlan}, validations}` da revisão vigente |
| `plan.payload.testPlan` | Somente `objective`, `requirementIds`, `ruleIds`, `priorities`, `exclusions`, `approach`, `preconditions`, `sources` |
| `priorities` | Itens `{ruleId, reason}` |
| `exclusions` | Itens `{description, reason}` |
| `sources` | Itens `{artifactId, locator, quote}` |
| `plan.validations` | Pareceres da revisão vigente do plano, somente `{outputId, outputRevision, validator, status}`; ausência ou erro não significam aprovação |
| `approvals` | Decisões humanas, somente `{id, outputId, outputRevision, actorId, at, decision, comment}` |

São selecionados também os campos internos do plano, fontes, pareceres e decisões.
`credentialRef`, configuração privada do alvo, documentos completos, caminhos,
`workIntents` e propriedades desconhecidas não integram a resposta. Conteúdo do
plano malformado gera conflito de registro, sem expor o registro original.

As duas rotas de decisão constroem somente o request permitido e chamam:

```ts
executePlanCommand(store, runId, request, { userId: session.userId });
```

Autoria vem da sessão; ID e horário da decisão vêm do serviço. As rotas não
fornecem `resourceReserved`. Aprovação e pedido de alteração preservam
`awaiting_approval` / `planning`, sem intenção de trabalho, criação de casos ou
chamada de modelo. T1.1 continua responsável por revisão vigente, pareceres,
comentário, conflito e repetição. Repetição válida conserva ID e horário originais.
Repetição sobre decisão anterior inválida retorna `409 / INVALID_DECISION`,
preserva o registro sem corrigir seu horário e não confirma aprovação.

Execução inexistente e execução de outra conta devolvem o mesmo `404`, código e
mensagem, sem dados da execução. E-mail informado nunca atribui propriedade:
`ownerId` é o ID interno da conta e execuções antigas não são associadas por e-mail.

### Erros HTTP

Erros usam sempre `{ "error": { "code": "CODIGO", "message": "Mensagem legível." } }`.
Não são expostos stack traces, caminhos, segredos ou dados de outra conta.

| HTTP | Situação e códigos |
| --- | --- |
| `400` | Entrada/JSON inválidos (`INVALID_INPUT`, `INVALID_JSON`), comentário obrigatório (`COMMENT_REQUIRED`), ID de execução inválido (`INVALID_RUN_ID`) ou conta esperada ausente, repetida ou inválida (`INVALID_EXPECTED_USER_ID`) |
| `401` | Sessão ausente, inválida ou expirada (`INVALID_SESSION`); login inválido com mensagem genérica (`INVALID_CREDENTIALS`) |
| `403` | Origem recusada (`ORIGIN_REJECTED`) ou cadastro não habilitado (`REGISTRATION_NOT_ALLOWED`) |
| `404` | Execução inexistente ou de outro proprietário (`RUN_NOT_FOUND`); rota não oferecida (`NOT_FOUND`) |
| `405` | Método não oferecido para a rota (`METHOD_NOT_ALLOWED`) |
| `409` | Conta esperada diferente da sessão (`ACCOUNT_CHANGED`); cadastro duplicado (`ACCOUNT_EXISTS`); revisão, estado, parecer ou decisão incompatíveis (`STALE_VERSION`, `INVALID_STATE`, `INSUFFICIENT_VALIDATION`, `DECISION_CONFLICT`, `INVALID_DECISION`); registro inválido/ambíguo (`INVALID_RECORD`, `AMBIGUOUS_RECORD`) |
| `413` | Corpo maior que 16 KiB (`BODY_TOO_LARGE`) |
| `415` | Conteúdo diferente de JSON (`UNSUPPORTED_MEDIA_TYPE`) |
| `429` | Excesso de tentativas de cadastro/login ou saturação de contadores (`TOO_MANY_ATTEMPTS`) |
| `503` | Origem não configurada (`AUTH_NOT_CONFIGURED`) ou armazenamento indisponível (`AUTH_STORAGE_UNAVAILABLE`, `STORAGE_FAILURE`, `RUN_INACCESSIBLE`) |

### Exemplos fictícios e teste HTTP

Configure `APP_ORIGIN=http://127.0.0.1:3000` e habilite `ana@example.invalid`.
Os comandos usam somente dados fictícios. A execução `run-demo-001` representa
um registro previamente criado pelo backend para o ID interno retornado no
cadastro; não há endpoint de preparação ou fixture carregada pela aplicação.

```sh
# Cadastro inicia a sessão e guarda o cookie e a resposta localmente.
qa_demo_dir=$(mktemp -d)
curl -sS -c "$qa_demo_dir/cookies" -o "$qa_demo_dir/account.json" \
  http://127.0.0.1:3000/api/auth/register \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"name":"Ana Exemplo","email":"ana@example.invalid","password":"Senha ficticia de exemplo 123","teamName":"Equipe Demo"}'

# Em acessos posteriores, o login também emite uma sessão nova.
curl -sS -c "$qa_demo_dir/cookies" -o "$qa_demo_dir/account.json" \
  http://127.0.0.1:3000/api/auth/login \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"email":"ana@example.invalid","password":"Senha ficticia de exemplo 123"}'

# Capture a conta ao preparar a operação; uma consulta posterior não a substitui.
qa_demo_expected=$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).user.id)' "$qa_demo_dir/account.json")
curl -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/auth/me
curl -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/runs/run-demo-001 \
  -H "X-Expected-User-Id: $qa_demo_expected"
curl -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/runs/run-demo-001/approve \
  -H "X-Expected-User-Id: $qa_demo_expected" \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"outputId":"out-planning","outputRevision":1}'

# Em outra execução ainda sem decisão, solicitar alteração exige comentário.
curl -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/runs/run-demo-002/request-changes \
  -H "X-Expected-User-Id: $qa_demo_expected" \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"outputId":"out-planning","outputRevision":1,"comment":"Incluir o limite superior da quantidade."}'

# Reconsulta a decisão persistida antes de sair.
curl -b "$qa_demo_dir/cookies" http://127.0.0.1:3000/api/runs/run-demo-001 \
  -H "X-Expected-User-Id: $qa_demo_expected"
curl -i -b "$qa_demo_dir/cookies" -c "$qa_demo_dir/cookies" \
  http://127.0.0.1:3000/api/auth/logout \
  -H "X-Expected-User-Id: $qa_demo_expected" \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' --data '{}'
rm -r "$qa_demo_dir"
```

Cadastro/login/me devolvem, por exemplo,
`{"user":{"id":"<id-interno>","name":"Ana Exemplo","email":"ana@example.invalid","teamName":"Equipe Demo"}}`.
Uma aprovação devolve `status: "awaiting_approval"`, `phase: "planning"` e a lista
`approvals` com a decisão `approved`, autor interno e ID/horário gerados pelo serviço.
A consulta posterior contém essa mesma decisão; logout não devolve JSON.

Com Node.js 24 e as dependências do lockfile, reproduza a jornada com
`node --import tsx --test test/authenticated-api.test.ts`. O teste inicia `createApp`
em porta temporária, usa `fetch`, duas contas e diretório temporário real, prepara
execuções apenas por `RunStore` e controla o relógio para expiração. Não reduz os
parâmetros de senha nem chama modelos. A verificação completa é `npm run check`,
`npm test` e `npm run build`.

## Criação e histórico de execuções — T3.3

[`src/application/runs.ts`](../../src/application/runs.ts) recebe a configuração
permitida, constrói o rascunho e consulta o histórico usando `RunStore`. As duas
rotas exigem a sessão e a precondição `X-Expected-User-Id` de T3.2. O proprietário
é sempre o ID interno da conta na sessão; não se aceita `RunRecord` completo,
`ownerId` ou identidade de autoria/propriedade fornecida pelo cliente.
O recorte cobre parcialmente RF-01, RF-08 e RF-11; RNF-04 e RNF-06.

### Criar um rascunho

`POST /api/runs` exige `Origin` exatamente igual a `APP_ORIGIN`,
`Content-Type: application/json`, `X-Expected-User-Id` correspondente à sessão e
um único cabeçalho `Idempotency-Key` com UUID v4.
A rota não aceita parâmetros de consulta na URL. O corpo aceita somente:

```json
{
  "name": "Reservas — primeira execução",
  "applicationName": "Aplicação de reservas",
  "objective": "Verificar as regras de quantidade.",
  "text": "US-01: Como usuário, quero reservar itens.\nCA-01: A quantidade deve ser inteira, entre 1 e 10."
}
```

`name` e `applicationName` são strings obrigatórias, com 1 a 120 caracteres após
remoção dos espaços externos. `objective` é string opcional, com até 2.000
caracteres após essa remoção; ausente ou vazio vira `""`. Os limites de caracteres
contam pontos de código Unicode. `text` é string obrigatória e deve conter algo
além de espaços. **O texto é preservado literalmente após a leitura do JSON**:
`trim()` só verifica se há conteúdo, sem alterar espaços externos, Markdown,
acentos, caracteres ou quebras de linha (`\n`, `\r\n` e `\r`). Não se identificam
nem contam histórias ou critérios pelo formato do texto.

Campos desconhecidos são recusados, incluindo `ownerId`, `id`, `status`, `phase`,
`outputs`, `validations`, `approvals`, `credentialRef` e `fixture`. O limite
existente de **16 KiB é do corpo JSON completo em bytes**, não apenas de `text`;
o excesso retorna `413`, inclusive em envio por partes, sem truncamento ou registro
parcial. JSON malformado, array, `null` ou tipo incorreto também são recusados.

O servidor define `ownerId`, `id`, `createdAt` em UTC, `status: "draft"` e
`phase: "intake"`. Cria um único artefato com ID gerado pelo servidor,
`name: "historias-e-criterios.txt"`, `version: "1"` e o texto literal. A entrada é:

```ts
{
  startUrl: null,
  credentialRef: null,
  accessProfile: null,
  dataPreparation: null,
  authorizedTarget: false,
  objective: /* objetivo normalizado, ou "" */,
  artifactIds: [/* ID do artefato criado */]
}
```

`outputs`, `validations`, `approvals`, `questions`, `answers` e `budgetCycles`
começam vazios. `validationPolicy` usa `{maxValidationRevisions: 3,
maxValidatorAttempts: 2, timeoutMs: 120000}`; nenhum ciclo de orçamento é aberto.
O envelope mantém `workIntents: []`. Falta de URL, credencial, perfil e preparo
é permitida em `intake`. Nenhuma curadoria, plano, aprovação ou intenção é
fabricada. Salvar o rascunho confirma o recebimento do material, **não que suas
US/CA foram reconhecidas ou validadas**. Criar e listar não acessam o aplicativo
alvo, reservam navegador ou chamam modelo.

Criação bem-sucedida responde `201`; repetição idempotente responde `200`. Ambas
incluem `Location: /api/runs/<id>` e somente estes seis campos:

```json
{
  "id": "run-<sha256-de-64-caracteres>",
  "name": "Reservas — primeira execução",
  "applicationName": "Aplicação de reservas",
  "createdAt": "2026-09-23T16:00:00.000Z",
  "status": "draft",
  "phase": "intake"
}
```

ID e horário acima são ilustrativos. A resposta nunca inclui texto original,
proprietário, hashes, credenciais ou metadados internos. `GET /api/runs/:id`
reutiliza a consulta de T3.2: abre o rascunho com `plan: null` e `approvals: []`.
Aprovar esse rascunho retorna `409 / INVALID_STATE`, sem alterar dados.

### Idempotência e persistência

O cabeçalho `Idempotency-Key` é obrigatório, normalizado para minúsculas e recusado
se ausente, inválido ou duplicado, inclusive com valores iguais. Para cada conta:

```ts
id = 'run-' + sha256(JSON.stringify([userId, chaveNormalizada]));
requestHash = sha256(JSON.stringify([name, applicationName, objective, text]));
```

Os hashes são SHA-256 em hexadecimal minúsculo. O segundo usa os nomes e objetivo
normalizados e o texto literal, nessa ordem fixa; a ordem das propriedades do
JSON enviado não interfere. `run.creation` guarda `{requestHash}` internamente,
no mesmo arquivo da execução, sem índice ou arquivo adicional. Quando presente,
esse campo é validado na leitura; registros antigos sem `creation` continuam
legíveis.

`RunStore.createIdempotent(...)` verifica existência e cria dentro da trava já
existente, retornando o registro e se houve criação ou repetição. Reutiliza leitura
e escrita internas; não chama `create()` nem `update()` dentro da trava, que não
é reentrante. `create()` conserva seu comportamento anterior. Confirmação de
sucesso só ocorre após concluir a persistência atômica.

| Situação | Resultado |
| --- | --- |
| Conta ainda não usou a chave | `201`, cria a execução |
| Mesma conta, chave e conteúdo normalizado | `200`, devolve a execução existente, inclusive em concorrência ou após reinício |
| Mesma conta e chave, conteúdo diferente | `409 / IDEMPOTENCY_CONFLICT`, sem alteração |
| Outra conta usa a mesma chave, com sua própria identidade esperada | Execução independente, com outro ID e proprietário |

A comparação usa `creation.requestHash` da criação original, nunca campos que
etapas posteriores possam ter modificado. Repetir conserva IDs, horário, artefatos
e trabalho posterior; não recoloca a execução em `draft` nem apaga resultados.
A confirmação da repetição reflete o estado atual salvo. Se a resposta falhar
depois da substituição do arquivo, o registro pode existir: o cliente repete a
**mesma chave, o mesmo conteúdo e a identidade esperada original**, obtendo a
criação original sem duplicação após autenticar novamente essa conta.

### Consultar o histórico

`GET /api/runs` exige `X-Expected-User-Id`, não aceita corpo e responde `200` com
`{"items": []}` para histórico vazio. Cada item contém somente os mesmos seis
campos públicos da confirmação. A ordenação é por
`createdAt` decrescente e, em empate, `id` decrescente. Há somente dois filtros
opcionais, combináveis:

| Parâmetro | Regra |
| --- | --- |
| `q` | Até 120 pontos de código Unicode antes de remover espaços externos; busca parcial em `name` ou `applicationName`, sem distinguir maiúsculas/minúsculas; vazio não restringe |
| `status` | Exatamente um de `draft`, `running`, `awaiting_approval`, `awaiting_input`, `completed`, `interrupted`, `error`, `cancelled` |

Exemplo: `GET /api/runs?q=reservas&status=draft`. Parâmetros desconhecidos,
duplicados, valores inválidos ou corpo retornam `400 / INVALID_INPUT`. Não se
aceita `ownerId` na URL ou no corpo. Primeiro são selecionados os registros do
proprietário da sessão; só então os filtros são aplicados.

`RunStore.listForOwner(...)` lê sequencialmente os registros existentes com
`read()` e suas verificações de arquivo, ignorando temporários. Para o volume do
piloto não há índice nem cache; indexação fica para quando o volume justificar.
Registro corrompido ou inacessível retorna `503 / STORAGE_FAILURE`, sem lista
parcial silenciosa e sem revelar o arquivo. Vale também para registros que não
passariam pelos filtros: a leitura precisa identificar seu proprietário com
segurança antes de selecioná-los.

### Erros e limites do recorte

As respostas usam o envelope de erro e `Cache-Control: no-store` de T3.2.

| HTTP | Código e situação |
| --- | --- |
| `400` | `INVALID_INPUT`: campos, tipos ou filtros inválidos; `INVALID_JSON`: JSON malformado; `INVALID_IDEMPOTENCY_KEY`: chave ausente, inválida ou duplicada; `INVALID_EXPECTED_USER_ID`: conta esperada ausente, inválida ou duplicada |
| `401` | `INVALID_SESSION`: sessão ausente, inválida ou expirada |
| `403` | `ORIGIN_REJECTED`: origem ausente ou diferente no POST |
| `409` | `IDEMPOTENCY_CONFLICT`: conteúdo diferente para a mesma conta e chave; `ACCOUNT_CHANGED`: conta esperada diferente da sessão, sem acessar execuções |
| `413` | `BODY_TOO_LARGE`: corpo JSON excede 16 KiB |
| `415` | `UNSUPPORTED_MEDIA_TYPE`: conteúdo diferente de JSON |
| `503` | `STORAGE_FAILURE`: falha de leitura, gravação ou registro corrompido/inacessível; sem confirmação falsa ou dados internos |

Com Node.js 24, `node --import tsx --test test/run-intake-api.test.ts` demonstra
**entrar → criar por POST → consultar histórico → abrir → reiniciar → entrar
novamente → reencontrar**, com `createApp`, `fetch`, duas contas e diretório
temporário. O teste principal não prepara a execução por `RunStore.create`.
Estados variados usados para testar filtros são simulações exclusivas dos testes;
a aplicação não carrega exemplos. A suíte cobre texto literal, isolamento,
repetição, concorrência, reinício, rejeições e falhas de armazenamento.

Upload de `.txt`, `.md` e PDF e seus limites maiores, edição, exclusão,
processamento/curadoria e execução dos agentes permanecem pendentes. O limite de
16 KiB corresponde apenas à entrada textual deste card. **RF-01, RF-11 e T3
continuam parcialmente implementados; curadoria e orquestração permanecem abertas.**
A interface deste recorte é documentada em T2.1 a seguir.

## Interface inicial — T2.1

[`src/web/index.html`](../../src/web/index.html),
[`src/web/app.js`](../../src/web/app.js) e
[`src/web/styles.css`](../../src/web/styles.css) implementam as páginas em HTML,
CSS e JavaScript nativos, servidas pelo mesmo processo Node da API. Não há
framework, roteador, servidor de frontend separado ou carga automática de dados
sintéticos. Este recorte faz parte de [T2 #5](https://github.com/mh131105/akcit-qa-agent/issues/5),
que permanece aberta.

### Rotas e relação com as APIs

| Página | Comportamento e API consumida |
| --- | --- |
| `/` | Redireciona para `/execucoes` |
| `/acesso` | Consulta `GET /api/auth/me`; cadastro com nome, e-mail, senha e equipe opcional por `POST /api/auth/register`; entrada por `POST /api/auth/login` |
| `/execucoes` | Histórico real por `GET /api/runs`, com `q` para nome/aplicação e `status` para situação; links para detalhe e nova execução |
| `/execucoes/nova` | Identificação, objetivo opcional e US/CA textuais; “Salvar rascunho” envia `POST /api/runs` com chave idempotente e abre o ID confirmado |
| `/execucoes/:id` | Consulta `GET /api/runs/:id`; quando há plano, exibe sua revisão e permite as decisões elegíveis por `POST /api/runs/:id/approve` e `POST /api/runs/:id/request-changes` |
| Saída da conta | `POST /api/auth/logout` com `{}`; aceita `204` sem tentar ler JSON |

As quatro páginas entregam o mesmo HTML; o endereço determina a página montada.
Links e recarregamento funcionam diretamente. Após cadastro ou login, a pessoa
retorna à página interna solicitada ou ao histórico. A conta do produto é
identificada como distinta do acesso que os agentes usarão na aplicação testada.

O helper HTTP envia `X-Expected-User-Id` nas operações de execuções e logout.
A identidade é capturada quando a operação é preparada; uma tentativa recuperada
usa seu `accountId` original. Consultas posteriores de sessão não substituem essa
identidade. `ACCOUNT_CHANGED` retira os dados privados da tela e conserva a
tentativa para a conta original, sem repetir a operação na conta recém-encontrada
nem encerrar automaticamente a sessão dela.

O servidor permite somente as páginas acima e `/web/app.js` e `/web/styles.css`,
com tipos de conteúdo explícitos. Os arquivos são encontrados a partir do módulo
do servidor, em desenvolvimento e após compilação, independentemente do diretório
do comando. `/api`, `/healthz` e os `404` de caminhos desconhecidos são preservados.
A política de conteúdo permite scripts, estilos e conexões da mesma origem, sem
scripts inline; incorporação em páginas externas permanece bloqueada.

### Entrada, histórico e estado verdadeiro

Nome da execução e aplicação aceitam até 120 pontos de código Unicode; objetivo,
até 2.000. O frontend confere os **bytes UTF-8 do JSON completo serializado**, com
todos os campos, contra 16 KiB. O valor de US/CA segue sem `trim()`, reescrita ou
truncamento. Erros mantêm os valores para correção, e confirmação depende de
resposta bem-sucedida do servidor. A API continua sendo a validação definitiva.

O histórico mostra nome, aplicação, data local, etapa e situação, e distingue
carregamento, primeira lista vazia, filtro sem resultados e falha recuperável.
O detalhe usa somente a projeção pública de T3.2. Um rascunho sem plano informa:
“Material recebido. O processamento ainda não foi iniciado.” Texto original,
board de US/CA, perguntas, percentuais e resultados não são fabricados nem
reconstituídos a partir de exemplos.

Com `plan`, são apresentados objetivo, IDs de requisitos e critérios
referenciados, prioridades e razões, exclusões e razões, abordagem,
pré-condições, fontes, revisão e situação da validação recebida. A consulta não
fornece o texto das US/CA para substituir suas referências.

As ações de revisão usam exatamente `plan.id` e `plan.revision` exibidos. Pedido
de alteração exige comentário não vazio, com limite de 4.000 caracteres. O
frontend oferece as ações conforme o estado público recebido; o servidor ainda
confere estado, curadoria vigente, pareceres, revisão e conflitos. Após uma
decisão, a página consulta novamente o registro e mostra decisão e revisão.
Aprovação mantém a execução em espera: não inicia testes nem cria casos.

### Recuperação da tentativa e erros

Antes do primeiro envio, a página gera um UUID v4 e guarda em `sessionStorage`
o ID interno da conta, a chave e a **string JSON exata** a enviar. Se não for
possível guardar a tentativa, informa a falha e não faz o POST. Durante o envio,
o botão fica desabilitado. Não se armazenam senha, token ou cookie nessa área.

Queda de conexão ou resultado incerto preservam a tentativa, incluindo após
recarregar a página. “Tentar confirmar salvamento” repete a mesma chave e o mesmo
corpo original e `accountId`; o formulário não transforma silenciosamente essa
tentativa em outro rascunho. Falhas conclusivas de preenchimento liberam correção. Sucesso
confirmado remove o registro. Logout só remove a recuperação após receber `204`.

A recuperação dura **na mesma aba e para a mesma conta, até confirmação ou
logout confirmado**; não é backup permanente do formulário. Depois de expiração
da sessão, o conteúdo pendente só reaparece após `GET /api/auth/me` confirmar o mesmo ID de
conta. Outra conta não recebe o formulário da anterior. Fechar a aba ou apagar
seus dados locais pode perder a possibilidade de recuperar a tentativa.
O preenchimento ainda não enviado também pode ser preservado ao sair da página
ou ao retirar a sessão, se o armazenamento local estiver disponível. Essa cópia
não tem chave de envio e não representa uma execução criada; sua preservação
ocorre nesses eventos, sem promessa de salvamento contínuo a cada alteração.

Ao receber `204` do logout, a interface primeiro impede que `rememberForm` ou
`pagehide` regravem o material, interrompe a verificação periódica de sessão e
retira os dados privados; então limpa os registros de recuperação e abre a página
de acesso. Se essa limpeza local falhar, a sessão continua tratada como encerrada
e a interface informa o problema de limpeza, sem reabrir a tela privada ou afirmar
que o logout falhou.

Falha de rede ou `503` no logout preserva chave, corpo original, identificação da
conta e mecanismo de recuperação. A mensagem é: “Não foi possível confirmar a
saída. Sua tentativa de salvamento foi preservada.” Isso não afirma que a sessão
continua ativa: o servidor pode ter encerrado a sessão e perdido apenas a
resposta. Uma confirmação posterior de sessão inválida retira os dados da tela
e mantém a recuperação restrita à conta original.

Antes de enviar uma decisão, a página mantém em memória
`{accountId, runId, outputId, outputRevision, comment}`, com o texto literal,
inclusive espaços. Esse contexto acompanha as reconsultas e “Tentar novamente”:

| Estado consultado | Recuperação do comentário |
| --- | --- |
| Mesma revisão, ainda sem decisão | Restaura o comentário e permite nova ação explícita do usuário |
| A decisão enviada já consta no servidor | Exibe a confirmação persistida e dispensa a cópia pendente |
| Revisão mudou ou há decisão conflitante | Mantém o comentário anterior para leitura/cópia, identificado pela revisão original; não preenche uma revisão nova |
| Consulta falhou | Mantém o contexto para a próxima tentativa de consulta |

A cópia aparece somente para a mesma conta e execução, não gera outro POST
automaticamente e não é persistida. Sua preservação cobre erros e reconstruções
da página atual; não há promessa de recuperação após recarregar ou fechar a aba.

Credenciais inválidas, participante não habilitado, excesso de tentativas,
configuração de origem e indisponibilidade recebem mensagens legíveis. Falhas de
consulta oferecem nova tentativa. Sessão inválida ou expirada remove dados
privados da tela e solicita entrada novamente. Além das respostas da API, a
sessão é conferida a cada 30 segundos enquanto a aba está visível e ao retornar
para a aba; nesse retorno, o conteúdo fica oculto até a conferência. Falha ao
conferir a sessão também retira os dados e solicita entrada. Conflito de decisão ou revisão
desatualizada explica a recusa e atualiza a consulta, sem reaplicar a decisão
automaticamente sobre uma revisão nova. Nenhum erro confirma salvamento ou
avanço.

As chamadas `fetch` usam `/api`, mesma origem e o cookie existente; o navegador
define `Origin`. Proprietário, autoria, aprovação do validador, estado e revisão
vigente continuam definidos no backend. Nomes, comentários, fontes e demais
dados recebidos são renderizados como texto por `textContent`. Formulários têm
rótulos, mensagens junto aos campos, foco visível e estados acessíveis de
carregamento e erro. O layout contempla 1366 px e 390 px.

### Verificação e limites

[`scripts/smoke-web.mjs`](../../scripts/smoke-web.mjs) usa Chromium,
`playwright-core`, servidor real e armazenamento temporário: cadastro/entrada,
histórico vazio, criação, detalhe, recarregamento, logout/login, recuperação de
resposta perdida sem duplicação, isolamento entre contas, texto com aparência
de HTML e decisões persistidas de planos. Planos e pareceres são preparados
**somente no armazenamento temporário do teste**; o teste não comprova geração
por IA. Capturas de desktop e celular são sintéticas. A reprodução está em
[OPERACAO.md](../OPERACAO.md#jornada-pelo-navegador--t21).

Cobertura parcial: RF-01, RF-08, RF-10, RF-11, RF-13 e RF-14; RN-05 e RN-06;
RNF-01, RNF-02, RNF-04 e RNF-06. Upload, edição de conta/execução, exclusão,
duplicação, board de US/CA, perguntas, início dos agentes, curadoria, geração do
plano, casos e relatório não fazem parte de T2.1. T4.1 abaixo acrescenta preparação
e consulta de perguntas; resposta/retomada, casos e relatório continuam pendentes. Este recorte
não encerra T2 nem comprova os cenários completos de aceitação do produto.

## Preparação do plano com especialistas — T4.1

Recorte implementado de T4 #7, T5 #8, T6 #9 e T10 #14: rascunho textual →
curadoria → validação independente → plano → validação independente → revisão
humana existente. A integração usa Pi **0.87.0**. A demonstração com inferência
real e a avaliação humana da frente C ainda dependem de credencial em T0; o estado
da verificação está em [evidencias/t4.1](../evidencias/t4.1/README.md).

### Início, repetição e cancelamento

Ambas as operações exigem sessão, `Origin` exata, um único `X-Expected-User-Id`
conferido contra a sessão e propriedade da execução. Recebem somente `{}`, com
`Content-Type: application/json`, sem parâmetros de consulta. Não recebem modelo,
credencial, limites, produtor, estado ou opção de simulação pelo cliente.

| Operação | Resposta e efeito |
| --- | --- |
| `POST /api/runs/:id/start` | Primeiro aceite: `202` com a projeção pública da execução. Persiste processamento, orçamento e `running/curation` antes de despachar; HTTP não aguarda os modelos |
| Repetição de `/start` já aceito | `200`, projeção do mesmo processamento, inclusive após cancelamento, erro ou interrupção; nenhum novo orçamento ou chamada |
| `POST /api/runs/:id/cancel` | `200`, cancelamento persistido. Aceita `draft`, `running`, `awaiting_input` e `awaiting_approval`; repetir `cancelled` é idempotente |

Antes do primeiro aceite, o coordenador confere `draft/intake`, ausência de saídas
e orçamento anterior, originais textuais preservados e suas referências; resolve
os três pares provedor/modelo e confere catálogo/credencial. Obtém reserva exclusiva
do ambiente, reconfere estado sob `RunStore.update()` e persiste o início. Há um
coordenador compartilhado por aplicação e um processo escritor por ambiente, sem
fila. Chamadas aos modelos ocorrem fora da trava de armazenamento.

| Recusa | HTTP / código |
| --- | --- |
| Outra preparação ocupa o ambiente | `409 / RESOURCE_UNAVAILABLE`; rascunho intacto |
| Par padrão ausente ou substituição incompleta | `503 / MODEL_NOT_CONFIGURED`; sem início |
| Modelo não existe no catálogo | `503 / MODEL_UNAVAILABLE`; sem fallback |
| Credencial não está disponível no ambiente privado | `503 / CREDENTIAL_UNAVAILABLE`; sem início |
| Estado não permite primeiro início/cancelamento | `409 / INVALID_STATE` |
| Material original inválido | `400 / INVALID_INPUT` |
| Execução ausente ou de outra conta | `404 / RUN_NOT_FOUND` |

Erros de sessão, identidade esperada, origem, JSON e armazenamento mantêm os
controles existentes. A API devolve mensagens sanitizadas; exceções brutas do Pi
ou provedor não são expostas. Cancelar persiste primeiro, impede novas chamadas e
aciona `session.abort()` na sessão ativa. Respostas tardias podem completar seu
registro técnico, mas não salvam saída nem avançam a execução. A reserva só é
liberada depois do encerramento da tarefa. Um cancelamento não desfaz registros.

### Conteúdo dos especialistas e fontes

Cada tarefa/tentativa usa sessão Pi nova, skill explícita do arquivo do papel,
originais da execução e nenhuma conversa de outro produtor ou execução. Terminal,
escrita, navegador, extensões, repetição automática e compactação do SDK ficam
desabilitados. A sequência das quatro tarefas é código; a qualidade é julgada pelo
`output-validator`, sem chamada adicional para escolher a próxima etapa.

| Produtor | Conteúdo JSON aceito |
| --- | --- |
| `artifact-curator` | `{requirements: [{id, statement, rules: [{id, statement, sources}], sources}], questions: [{id, description, requirementIds, caseIds: [], blocking, sources}]}` |
| `test-designer` | `{testPlan: {objective, requirementIds, ruleIds, priorities: [{ruleId, reason}], exclusions: [{description, reason}], approach: string[], preconditions: string[], sources}}` |
| `output-validator` | `{status: approved \| changes_requested \| blocked, findings: [{code, message, location: string \| null}], reason}` |

O backend recusa campos extras, inclusive metadados de saída definidos pelo modelo.
IDs têm até 128 caracteres, começam por letra/número e usam letras, números,
`_`, `.`, `:`, `-`. Requisitos, critérios e perguntas têm IDs únicos na curadoria;
referências precisam existir. Há até dez US; excesso interrompe sem truncamento.
Cada fonte exige `artifactId` existente, `locator` **`Lx` ou `Lx-Ly`**, com linhas
do `artifact.text` contadas desde 1, e `quote` não vazio, literal, contido nas
linhas indicadas. Cada requisito, critério, pergunta e plano precisa de fontes.
O parser limita o JSON serializado a 200 mil caracteres, listas a 300 itens e
textos individuais a 20 mil caracteres. Rejeição estrutural consome tentativa.

Pergunta sempre identifica os requisitos afetados. Se não há US identificável,
`requirements: []` exige pergunta bloqueante com `requirementIds: []` e fonte;
uma US sem CA exige pergunta bloqueante localizada. Não se inventa US ou critério
para preencher o contrato. Requisitos com CA e sem questão bloqueante são
elegíveis; dúvidas em outros requisitos não impedem seu planejamento. O plano
somente referencia requisitos elegíveis e critérios pertencentes a eles. Exclusões
e pendências precisam aparecer com justificativa, conferida pelo validador.

Curador preserva condições, valores, exceções e opcionalidade. Planejador recebe
originais **e** a curadoria aprovada; não cria casos detalhados ou navegação
presumida. O validador recebe a saída exata com ID/revisão e documentos pertinentes
em sessão própria. Confere semântica, completude, fontes e cobertura. Justificativa
é sempre obrigatória; correção/bloqueio exige achados. O backend registra falha
técnica como `error`, não delega esse estado ao modelo. Validação estrutural não
prova que um limite ou campo opcional foi preservado.

### Persistência, limites e transições

O backend define ID da saída, `producer`, `revision`, `createdAt`, `budgetCycleId`,
`dependsOn` e `answerRefs`. Salva a revisão antes de validar, salva o parecer antes
de avançar e mantém IDs/histórico nas correções. O plano depende exatamente de
`{outputId, revision}` da curadoria vigente e aprovada, reconferida antes de salvar.
As regras existentes de aprovação humana permanecem: somente plano e dependência
vigentes, com um parecer de qualidade aprovado para cada revisão, autorizam a
decisão. Aprovar registra a decisão e mantém a espera; `/continue` não é implementado.

`run.preparation` registra `id`, `budgetCycleId`, `startedAt`, `finishedAt`,
`activeRole`, `activity`, `stopReason`, `limits` e `calls`. Cada chamada registra
`id`, `role`, `provider`, `model`, `phase`, `attempt`, `outputRevision`, `startedAt`,
`status`; ao terminar, `finishedAt`, `durationMs` e `errorCode` quando pertinente.
Consumo disponível usa `usage.{input,output,cacheRead,cacheWrite,totalTokens}`;
`estimatedCost` é **estimativa do Pi**, não cobrança confirmada. Métricas ausentes
são omitidas. Não se persistem raciocínio interno ou resposta bruta inválida.
Pareceres acrescentam `id`, `at` e `attempt` aos vínculos/achados do contrato.
Novos metadados são opcionais para compatibilidade com registros anteriores.

O ciclo inicial é único: `reason: initial_preparation`, `answerRef: null`,
`affectedCaseIds: []` e os limites aplicados. Até três tentativas de produção por
saída, incluindo revisões e respostas inválidas; até duas tentativas técnicas do
validador por revisão, incluindo a inicial; 120 segundos por chamada e 45 minutos
de processamento ativo. Não se reinicia orçamento após erro. Parecer válido
`changes_requested` retorna ao produtor; o coordenador não corrige o conteúdo.

| Evento | Estado persistido |
| --- | --- |
| Início aceito | `running/curation` |
| Curadoria aprovada com requisito elegível | `running/planning` |
| Validação em andamento | Mantém a fase da saída; `activeRole: output-validator` |
| Plano aprovado pelo validador | `awaiting_approval/planning`; libera ambiente |
| Correção solicitada | Permanece na fase, nova revisão dentro do limite |
| Material insuficiente sem independente elegível | `awaiting_input`, perguntas/motivo preservados |
| Limite de US, revisões, tentativas inválidas de validação ou tempo ativo excedido | `interrupted`, motivo preservado |
| Validador bloqueia saída com material elegível | `interrupted`, sem aprovação ou avanço |
| Falha técnica sem recuperação, inclusive timeout após tentativas permitidas | `error`, motivo preservado |
| Cancelamento confirmado | `cancelled`; nenhum novo trabalho |
| Reinício durante `running` | `interrupted`, chamadas ativas interrompidas e `SERVICE_RESTART`; sem retomada automática |

O timeout cancela a sessão e aguarda seu encerramento; não usa apenas uma corrida
de promessas. Espera humana não consome orçamento ativo. `/start` não retoma
execuções interrompidas/canceladas nem abre ciclo adicional.

### Projeção pública e interface

`GET /api/runs/:id`, `/start` e `/cancel` retornam a projeção de revisão existente
(`id`, `name`, `applicationName`, `createdAt`, `status`, `phase`, `plan`, `approvals`)
acrescida de:

```ts
progress: { processingId: string | null; activeRole: string | null;
  activity: string | null; startedAt: string | null; finishedAt: string | null };
stopReason: { code: string; message: string } | null;
questions: { id: string; description: string; requirementIds: string[];
  blocking: boolean; sources: { artifactId: string; locator: string; quote: string }[] }[];
```

Atividades são `curating`, `validating_curation`, `planning`, `validating_planning`.
A projeção não devolve registro interno, credenciais, prompts, chamadas, orçamento
ou originais completos. `plan` pode existir provisoriamente durante validação;
isso não autoriza decisão. A interface mostra fase, papel/atividade, motivo e
pendências; oferece “Preparar plano” no rascunho e “Cancelar preparação” durante
o trabalho. Consulta a cada dois segundos enquanto `running`, preservando a
identidade capturada pelo helper HTTP. Em `awaiting_approval/planning`, encerra
polling e usa os controles existentes sem reconstruir o comentário. Perguntas
não têm campo de resposta sem função: `/answer` e retomada continuam pendentes.

## Mapeamento, dúvidas e execução

Tela: `{id, name, recognition}`. Transição: `{id, from, action, to}`. Caminho:
`{id, startScreenId, transitionIds}`. URLs observadas ajudam a reconhecer telas, mas
não substituem o percurso natural desde a entrada autorizada. Exploração cobre o
escopo aprovado; não investiga limites por tentativa e erro.

`techniques` explica classe/limite, regra de origem e valores escolhidos. AVL depende
do domínio: o vizinho de um inteiro difere de moeda ou data. O executor usa visão,
cursor, teclado, rolagem e arrastes, sem atalhos por JavaScript, API ou banco para
produzir o comportamento avaliado. Configurar navegador e capturar tela são operações
de infraestrutura. Preparação/restauração de dados segue procedimento explícito fora
das ações avaliadas; o executor confirma e registra pré-condições antes de cada tentativa.

`run.questions` concentra questões da curadoria ou de outras etapas. A resposta do
usuário vira registro imutável em `run.answers`; correção incrementa sua `revision`.
Questão pode bloquear somente seus `caseIds` (ou casos do requisito ainda não criados).
Independentes continuam. Caminho não encontrado gera questão, não prova de defeito.
Depois de uma resposta, aplicar as revisões e aprovações pertinentes e conferir as
pré-condições novamente; a retomada começa no início do caso. A resposta sozinha não
libera uma conclusão nem cancela os controles anteriores.

Uma tarefa de agente/navegador ocupa o ambiente por vez. A espera humana libera esse
recurso; outra execução pode usar o ambiente. A primeira só continua ao obter o recurso
novamente. Não criar fila nesta sprint: ambiente ocupado gera resposta explícita para
a pessoa tentar continuar depois, preservando decisões já salvas. O backend garante
que duplo clique não duplica trabalho nem decisões.

`run.validationPolicy` usa `maxValidationRevisions: 3`, `maxValidatorAttempts: 2` e
`timeoutMs: 120000`, como limites iniciais propostos. Revisões incluem a primeira
saída de cada ciclo automático; tentativas incluem a chamada inicial. Tetos de entrada,
ações e tempo total seguem RNF-07/RNF-08 em [PROTOTIPO.md](PROTOTIPO.md) e ficam
registrados na execução. Espera humana não consome orçamento de trabalho ativo.
Esgotar limite interrompe dependentes, expõe a causa e preserva dados; não permite
aprovação pelo orquestrador.

Resposta humana pode abrir novo ciclo limitado somente para itens afetados. Registrar
em `run.budgetCycles` o `id`, `startedAt`, `reason`, `answerRef` (nulo no ciclo inicial),
`affectedCaseIds` e `limits` utilizados. `output.budgetCycleId` vincula a saída ao ciclo;
seu número de revisão continua crescendo, sem apagar as antigas. O backend reinicia
apenas os contadores autorizados pelo novo orçamento explícito e mantém o consumo
anterior visível. Não reiniciar orçamento automaticamente por erro ou nova tentativa.

## Estados, encerramento e evidências

`run.phase`: `intake`, `curation`, `planning`, `case_design`, `mapping`, `route_detail`,
`execution`, `report`, `done`. Durante validação ou aprovação humana, permanece na
fase cuja saída está sendo conferida.

| `run.status` | Significado |
| --- | --- |
| `draft` | Configuração salva; processamento ainda não iniciado |
| `running` | Uma tarefa está sendo processada |
| `awaiting_approval` | Plano ou casos aguardam decisão humana |
| `awaiting_input` | Falta esclarecimento/acesso e não há trabalho independente disponível |
| `completed` | Processamento encerrado e relatório final validado; pode conter testes reprovados ou bloqueados |
| `interrupted` | Limite, bloqueio global ou reinício impediu continuar |
| `error` | Falha técnica sem recuperação |
| `cancelled` | Usuário encerrou a execução |

Cancelamento persiste o pedido, impede novas ações e chamadas e encerra navegador e
gravação de forma controlada. Resposta tardia de modelo não retoma uma execução
cancelada. Preservar observações já salvas; não prometer desfazer ações do aplicativo.
Ao reiniciar o backend, uma execução que estava `running` vira `interrupted`, sem
retomada automática no meio de um caso. Rascunhos e esperas humanas permanecem salvos.
Duplicar cria outra execução em `draft`, copiando explicitamente a configuração e os
artefatos selecionados do mesmo proprietário, sem conclusões, aprovações ou memória
herdadas. A nova `credentialRef` começa nula; o acesso precisa ser reconfirmado, sem
compartilhar o segredo privado de outra execução. Isso não interfere na retomada de dúvidas prevista acima.

Depois de processar os casos elegíveis, o usuário pode **encerrar com pendências**.
Isso dispensa esperar indefinidamente por respostas, preserva bloqueados/não executados
e suas razões e encaminha os resultados e o relatório para validação. Só então a
execução pode ficar `completed`, sem significar aprovação do aplicativo. A ação não
ignora uma saída rejeitada nem encerra enquanto houver caso independente executável.
Esse encerramento deliberado é diferente de cancelar, que impede novas chamadas.

| `result.verdict` | Critério |
| --- | --- |
| `not_run` | Sem tentativa e sem impedimento específico identificado |
| `passed` | Observação suficiente atende à expectativa rastreável |
| `failed` | Observação suficiente contradiz a expectativa rastreável |
| `blocked` | Pré-condição, acesso ou dúvida impediu executar; pode não haver tentativa |
| `inconclusive` | Houve tentativa, mas faltam elementos para concluir |

`attempt.status`: `completed`, `blocked`, `error`, `interrupted`. Erro da tentativa
não prova defeito no aplicativo. Eventos registram `at`, `action`, `observation`.
Cada tentativa tem veredito e motivo próprios. Uma violação sustentada não desaparece
se outra tentativa passar; registrar a variação. Não tomar a última tentativa como
verdade por padrão. Corrigir veredito sem suporte preserva a revisão rejeitada.

Vídeos usam `kind: "video"`, `capture: "original" | "reproduction"`, `startMs`, `endMs`
e `assetId`. Corte em arquivo próprio começa em zero. Reprodução ganha outra tentativa
com `reproducesAttemptId`. Vídeos curtos mostram ação e resultado, em sucesso e falha.
Falta de captura fica em `evidenceGaps`; não sustentar veredito sem evidência suficiente.
Vídeo acessível por caso executado é exigido para a demonstração completa.

Relatório relaciona US/CA, caso, esperado, observado, parecer e mídia; inclui bloqueados,
inconclusivos e não executados. A página de impressão usa capturas representativas no lugar de vídeos, identifica a
execução/versão e permite salvar em PDF pelo navegador, conforme RF-17. Relatório parcial só utiliza conclusões validadas e registros
técnicos; não publica saída rejeitada como achado. Validá-lo não muda `interrupted`,
`error` ou `cancelled` para `completed`. O progresso técnico permanece acessível mesmo
sem relatório. Cancelamento não dispara chamadas novas para produzir um relatório.

## API mínima proposta

Esta seção descreve o contrato completo proposto do produto. Estão disponíveis
as rotas de T3.2, criação/histórico de T3.3 e início/cancelamento de T4.1, nos limites
documentados acima. A consulta individual entrega projeção de plano, progresso,
motivo e perguntas, incluindo `plan: null` para rascunhos. As demais operações, inclusive `/continue`,
aguardam a integração correspondente.

Cadastro e entrada permitem obter a sessão; saída a invalida. Todas as operações
de execução abaixo exigem usuário autenticado, `X-Expected-User-Id` e conferência
de proprietário. Operações
com versões desatualizadas são recusadas com motivo legível; mídia não expõe caminhos
internos nem segredos. Autenticação e cadastro seguem os RF do produto.

| Operação | Responsabilidade |
| --- | --- |
| `POST /api/runs` | Criar rascunho com configuração e cópia dos artefatos |
| `PATCH /api/runs/:id` | Editar rascunho ou completar acesso pendente da mesma aplicação antes do mapeamento; não substituir artefatos após início |
| `GET /api/runs` | Histórico do proprietário, com estado e data |
| `GET /api/runs/:id` | Estado, fase, versões, questões, aprovações, pareceres e resultados; distinguir provisório, validado e desatualizado |
| `POST /api/runs/:id/start` | Validar US/CA e iniciar curadoria/plano, se recurso disponível; acesso pode estar pendente |
| `POST /api/runs/:id/approve` | Registrar aprovação para `outputId` e `outputRevision`; autor vem da sessão |
| `POST /api/runs/:id/request-changes` | Registrar decisão sobre revisão exata e comentário; análise do pedido aguarda continuidade com recurso reservado |
| `POST /api/runs/:id/answer` | Registrar resposta versionada para questão e casos afetados |
| `POST /api/runs/:id/continue` | Retomar trabalho autorizado/clarificado, se recurso disponível |
| `POST /api/runs/:id/finish-with-pending` | Após casos elegíveis, registrar encerramento das pendências e gerar relatório sujeito à validação |
| `POST /api/runs/:id/cancel` | Cancelar preservando os dados existentes |
| `POST /api/runs/:id/duplicate` | Criar novo rascunho com cópia explícita de entradas |
| `GET /api/runs/:id/evidence/:assetId` | Entregar mídia pertencente à execução |
| `GET /api/runs/:id/report/print` | Versão de impressão do relatório publicado, final ou parcial; navegador permite salvar PDF |
| `DELETE /api/runs/:id` | Após confirmação, excluir execução encerrada, sua credencial e mídias locais; informar tratamento separado de backups |

Upload e resposta a perguntas aguardam integração. T4.1 consulta o progresso
durante a preparação; aprovar já persiste a decisão humana sem iniciar casos;
quando `/continue` existir, a interface poderá solicitar a continuidade depois.
Se o recurso estiver ocupado, o usuário não deverá perder sua resposta ou
aprovação. A revisão humana do plano mantém a espera após a decisão.

## Exemplo e verificação

O [artefato](exemplos/artefato-demo.md) e o [JSON](exemplos/execucao-demo.json) são
sintéticos. `fixture: true` existe somente no exemplo e o backend não o aceita
como execução real. A interface de T2.1 não carrega esse JSON. Não há mídia ou
chamadas de modelo no exemplo.

O exemplo apresenta plano e casos aprovados antes do mapa, detalhamento preservando
os campos aprovados e uma execução devolvida por falta de evidência. Sua revisão 2
registra incerteza e alimenta o relatório parcial; a revisão 1 permanece histórica.
Conferir referências, versões, fontes, herança da aprovação de casos e estados. Esse
JSON ajuda a integrar formatos; não comprova agentes, segurança, cobertura ou execução.
