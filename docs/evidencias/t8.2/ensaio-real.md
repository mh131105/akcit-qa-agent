# T8.2-R1 — Ensaio real do mapeamento visual validado

> Inferência real com os modelos documentados, navegador e ferramentas reais,
> na imagem final construída do código versionado. Executado com
> `npm run eval:mapping:real` (`scripts/eval-mapping-real.mjs --run`), usando a
> composição normal do aplicativo — **nenhuma** substituição de `modelCall`,
> `visualCall`, preflight, navegador ou pareceres.

## Candidato avaliado

| Item | Valor |
| --- | --- |
| Branch | `feat/validated-navigation-map` |
| SHA da jornada A | `f46c504ce78beb76cbcdccd04fadd9d4ed4be997` (imagem `28ff5f9c5761`) |
| SHA final (jornada B, credencial e controles) | `58daf904b610d37c5153f60e42bd59634ba142a5` (imagem `47bd28ecd54b`) |
| Base da imagem | `docker build --target runtime`, Node 24, usuário `node`, restrições do CI (`--cap-drop=ALL --security-opt=no-new-privileges`) |
| Alvo | T7 (`scripts/demo-target.mjs`, modo `reference`), conta `demo`/`demo1234` |
| Entrada | `US-01: Criar reservas.` / `CA-01: A quantidade de reserva aceita está entre 1 e 10.` |
| Armazenamento | isolado (`/data/eval` em tmpfs, apagado a cada execução) |

A jornada A rodou no SHA `f46c504` e encontrou uma falha real (JSON do executor
embrulhado em cercas de código). A correção gerou o candidato `58daf904`, no
qual **o cenário afetado (produção do mapa) foi repetido** — na jornada B
completa e no cenário de credencial inválida — e **uma execução completa**
(jornada B) foi refeita, além dos controles do validador.

## Perfis aplicados (registrados, sem fallback silencioso)

| Papel | Modelo | Nível |
| --- | --- | --- |
| Curador | `deepseek` / `deepseek-flash` | `low` |
| Projetista (plano/casos) | `deepseek` / `deepseek-v4-pro` | `high` |
| Validador textual | `deepseek` / `deepseek-v4-pro` | `high` |
| Executor visual | `deepseek` / `deepseek-flash` | `high` |
| Validador visual | `deepseek` / `deepseek-flash` | `high` |

A disponibilidade foi conferida pelo preflight do próprio aplicativo antes de
reservar o ambiente; o recebimento efetivo das imagens é atestado pelo consumo
de entrada registrado nas chamadas do validador visual (ex.: 7.260 tokens de
entrada na validação da jornada B) e pelos pareceres que citam o conteúdo das
telas (títulos, textos e estados vistos nas capturas).

## Execuções e estados finais

| Cenário | Execução | Estado final | Parecer do validador visual |
| --- | --- | --- | --- |
| Jornada A — interface + revisão independente | `run-caffef13d6eb82da37eb64081eb994f0137c144317006c54c2be0db26cc39d9c` | `ready / mapping` | `approved` (4 telas, 3 transições, percurso login → início → reservas → nova reserva, limitações honestas) |
| Jornada B — aprovações automatizadas (registradas como tal) | `run-7d676ee0effbfaf431e2…` | `ready / mapping` | `approved` |
| Credencial inválida e correção | `run-35bfeb7161f75ef486a0…` | 1ª tentativa `awaiting_input / CREDENTIAL_REJECTED` → correção (revisão de acesso 2) → nova tentativa → `ready / mapping` | bloqueio: `blocked` com `AUTHENTICATION_MISSING`; após correção: `approved` |
| Controles do validador (mapa real e cópia adulterada) | a partir de `run-caffef…` e de `run-7d676e…` | — | positivo `approved`; negativo `changes_requested` com o achado localizado |

### Jornada A — acompanhada pela interface

Requisitos → curadoria → plano validado → **revisão do plano** → casos validados
→ **revisão dos casos** → acesso → mapeamento → validação visual → `ready`.
Toda a interação (cadastro, rascunho, aprovações, configuração do acesso e botão
**Mapear aplicação**) foi feita na interface com navegador real; após recarregar,
o mapa e as capturas por `blob:` permaneceram acessíveis (captura
`ui-mapa-run-caffef….png`).

- **Revisão do plano e dos casos:** emitida por um **avaliador independente
  (subagente do ensaio)**, que leu o conteúdo real gravado em
  `artifacts/human/awaiting-*.json` e registrou as decisões em
  `decision-*.json` (`approved`, com justificativa detalhada). A revisão humana
  final desta entrega cabe ao revisor do PR sobre os artefatos registrados.
- O conteúdo revisado: curadoria fiel às fontes (US-01/CA-01 sem regras
  inventadas); plano com partição de equivalência e análise de valor limite nas
  fronteiras 1/10 e vizinhos 0/11; casos sem percurso inventado (`pathId: null`,
  sem `caseId`/`attemptId`).

### Credencial inválida e correção

Com a senha incorreta, o executor observou a tela de login com "Credenciais
inválidas" e produziu `authentication: not_authenticated`; o validador visual
independente emitiu `blocked` com achado `AUTHENTICATION_MISSING` (parecer real,
citando as capturas), e a execução terminou `awaiting_input / CREDENTIAL_REJECTED`
sem avanço. Após corrigir a credencial (nova revisão de acesso, `accessRevision`
1 → 2) e solicitar nova tentativa explícita, o mapeamento concluiu em
`ready / mapping`. **Histórico preservado:** as saídas de mapeamento passaram de
1 para 2 (a anterior não foi apagada) e o tempo ativo acumulado continuou
crescendo (238.427 ms → 292.288 ms, sem zerar).

### Controles positivo e negativo do validador

- **Positivo:** o parecer real emitido no fluxo sobre o mapa sustentado por
  capturas reais — `approved`, com razão que confere telas, transições, ações e
  a sequência temporal das observações.
- **Negativo:** cópia do mapa real com **uma transição deliberadamente sem
  suporte** (a observação de destino trocada por outra existente, mantendo todas
  as referências válidas — o parser estrutural aceita a cópia). O validador
  localizou a inconsistência: `changes_requested` com
  `TRANSITION_EVIDENCE_MISMATCH` em `transitions/ir-reservas` (jornada B) e
  `VISUAL_EVIDENCE_MISMATCH` em `transitions/inicio-para-reservas` (jornada A).
  A recusa veio da avaliação semântica do modelo sobre as imagens, não do
  parser (nenhum identificador inexistente).

## Chamadas, duração e consumo informado

| Cenário | Chamadas registradas | Observações / ações | Consumo relevante |
| --- | --- | --- | --- |
| Jornada A | 21 (curador, validador textual ×4, projetista ×2, executor ×14) | 5 capturas / 8 ações | validador visual ~10 s; `usage` por chamada registrado no registro da execução |
| Jornada B | 19 | 4 capturas / 7 ações | validador visual: entrada 7.260, saída 1.222, cache 896, total 9.378 tokens |
| Credencial | 2 produções de mapa + validações | — | — |
| Controles | 2 validações visuais | — | negativa: entrada 4.442, saída 1.873, total 10.027 tokens |

Todas as chamadas foram persistidas com início e término (`PreparationCall`),
incluindo as 14 inferências do ciclo de ferramentas do executor. Custo não foi
informado pelo provedor; nenhum valor foi inventado.

## Avaliação do mapa (revisor do PR)

- **Percurso real:** login → início → reservas → nova reserva (telas com
  reconhecimento fiel: "Login", "Início", "Reservas — Nenhuma reserva
  encontrada", "Nova reserva — Quantidade/Comentário/Confirmar").
- **Sustentação:** telas e transições referenciam capturas e ações reais; o
  validador conferiu a sequência temporal das observações.
- **Nenhuma reserva criada** durante o mapeamento (verificado pelo roteiro).
- **Nenhum caso apresentado como executado** (payload sem `caseId`/`attemptId`;
  limitação honesta: o formulário foi mapeado sem submissão).
- **Mapa e imagens acessíveis na interface após recarregar** (verificado pela
  jornada A).

## Falhas encontradas e resolução

1. **Executação real do executor recusada (jornada A, SHA `f46c504`):** o modelo
   devolveu o mapa correto embrulhado em ` ```json …``` `; o parse recusava e as
   três revisões se esgotavam sem publicar o mapa. **Correção:** tolerância de
   formato no runtime (extrai o objeto JSON; a validação estrutural continua) e
   orientação de "JSON puro" nas skills e no prompt de sistema (commit
   `f46c504`→`58daf904`). **Repetição:** produção do mapa refeita com sucesso na
   jornada B e no cenário de credencial, no novo candidato.
2. **Falhas do próprio roteiro do ensaio** (não do produto), corrigidas e
   repetidas: `Idempotency-Key` ausente nas criações via API; corrida de
   renderização da interface ao preencher formulários (preenchimento por ID com
   verificação); espera de navegação sem limite. Todas resolvidas antes do
   candidato final.
3. Falhas dos smokes herdadas do PR (`14ca870`) — ver
   [revisao-pr29.md](revisao-pr29.md).

## Evidências exportadas (sanitizadas)

- `artifacts/ensaio-real/jornada-interface-run-caffef…/` — projeção, registro
  sanitizado (sem credencial) e capturas reais da jornada A.
- `artifacts/ensaio-real/ui-mapa-run-caffef….png` — interface com o mapa validado.
- `artifacts/ensaio-real/jornada-completa-aprovacoes-automatizadas-run-7d676e…/`
  e `credencial-run-35bfeb…/` — jornada B e cenário de credencial.
- `artifacts/ensaio-real/report-jornada-a-e-controles.json` e `report.json` —
  relatórios das duas execuções.
- `artifacts/human/awaiting-*.json` e `decision-*.json` — conteúdo revisado e as
  decisões emitidas.

Sem credenciais, sessões, contas privadas ou conteúdo de usuários nos arquivos
versionados; as evidências acima ficam fora do controle de versão.
