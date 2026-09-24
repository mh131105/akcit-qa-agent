# T6.1 — Casos lógicos do plano aprovado

Verificação em **24/09/2026**, sobre
[`c17a58554867c2a542f493dac3e633d48a77e714`](https://github.com/mh131105/akcit-qa-agent/commit/c17a58554867c2a542f493dac3e633d48a77e714).
Base: PR #22 integrado em `71781a2`. Entrega:
[PR #23](https://github.com/mh131105/akcit-qa-agent/pull/23), para `develop`.
Node **24.21.0**, Pi **0.87.0**; os três papéis usam **`openai-codex/gpt-6-astra`**,
com OAuth privado autorizado do ambiente e sessão própria por chamada.

As [expectativas](expectativas.md) e os materiais públicos controlados
([prosa](entrada-prosa.txt), [Gherkin](entrada-gherkin.feature)) foram gravados às
**23:02:08 UTC**, antes das inferências iniciadas às **23:11:35 UTC**, e incluídos
no commit testado. SHA-256 das expectativas:
`9a0cf5b2fa27982980e4b1d7bc2530bafd66574d4a60d3133c45842a2bb2cdc0`.
Gabarito, notas de avaliação, resultados simulados e descrições de navegação não
entraram nos prompts. Objetivo vazio; somente os textos publicados alimentaram
as respectivas execuções. Não há documentos de usuários nestas evidências.

## Testes automatizados com respostas simuladas

Sobre o commit testado, passaram em Node 24:

```sh
npm run check
npm test
npm run build
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run smoke:web
```

- **127/127 testes**, typecheck e build aprovados.
- Smoke web: **27 verificações**, **21.141 ms**, Chrome **149.0.7827.201**.
  Site, API e persistência reais; respostas dos especialistas simuladas, sem
  inferência paga. Inclui aprovar plano → gerar casos → progresso → consulta após
  recarregar, conteúdo provisório e controles de conta existentes.
- Domínio/coordenador/API/armazenamento/runtime cobrem autorização, fontes,
  cobertura de regras, excesso sem truncar, correção, bloqueio, limites, repetição,
  concorrência, cancelamento/resposta tardia, orçamento acumulado e reinício.

O smoke não comprova qualidade semântica. A inferência real abaixo foi feita pela
API HTTP e pelo coordenador, sem uma nova jornada visual ou captura pela UI.

A [primeira CI](https://github.com/mh131105/akcit-qa-agent/actions/runs/36071588634)
passou testes, build e smoke de runtime/container, mas falhou no trecho antigo de
expiração de sessão do smoke web. A reprodução posterior permaneceu em
`/execucoes`, exibindo “Consultando sessão…”. O helper de login do smoke passou a
aguardar a interface autenticada e o fim do carregamento antes de remover sua
interceptação. Nenhum timeout foi ampliado, verificação removida ou código de
produto alterado. O mecanismo interno exato da intermitência no Chromium não foi
isolado; o ajuste sincroniza explicitamente uma transição antes implícita.

Após o ajuste, **três execuções consecutivas passaram nas 27 verificações** no
container com **uma CPU**, Node **24.21.0** e Chromium **153.0.8010.52**, em
**30.144 ms**, **30.428 ms** e **30.188 ms**. Foi usada a imagem local
`akcit-qa:t61`, construída por `docker build --target runtime -t akcit-qa:t61 .`,
com o script atualizado montado somente para leitura e os mesmos limites e
restrições da CI. A frente B reconferiu o ajuste e manteve o parecer aprovado.
O estado final da CI do commit publicado é registrado no PR.

## Inferência real e persistência

Executado das **23:11:35 às 23:14:25 UTC** (19:11–19:14 em Manaus), com servidor
local e diretório temporário isolado. Um script temporário de demonstração usou
`createApp` sem substituição de `modelCall`/`modelPreflight`, conta controlada,
rotas autenticadas, cabeçalhos de origem/conta e o runtime real:

```sh
node --env-file=.env --import tsx /tmp/akcit-t61-real-demo.mjs
```

Esse script foi uma ferramenta local ad hoc, não um comando distribuído no repo.
Para reproduzir, siga [o roteiro T6.1 em OPERACAO.md](../../OPERACAO.md#gerar-e-consultar-casos-lógicos--t61)
com as entradas desta pasta: criar rascunho, `/start`, consultar, aprovar a revisão
exata, `/continue` e consultar até encerrar. Configure privadamente o mesmo modelo
ou registre explicitamente outro par. Nenhuma credencial ou sessão é publicada.

Cada plano recebeu uma **aprovação automatizada autorizada para o ensaio**, usando
a operação autenticada normal. São duas decisões controladas para habilitar a
continuidade, **não aprovações humanas nem revisão humana da frente C**. As saídas
e os pareceres vieram de inferências reais, sem payloads pré-fabricados.

| Entrada | Curadoria / plano / casos | Casos | Chamadas | Tokens | Tempo ativo antes → depois dos casos |
| --- | --- | --- | --- | --- | --- |
| Prosa | r1 / r1 / r1, aprovadas | 6 | 6 | 19.922 | 50,774 s → 109,192 s |
| Gherkin | r1 / r1 / r1, aprovadas | 1 | 6 | 15.243 | 39,075 s → 52,397 s |

Ambas terminaram em `awaiting_approval/case_design`. O primeiro `/continue`
retornou `202`; repetições durante e depois do processamento retornaram `200`,
sem novas chamadas. Intenções terminaram `completed`; releitura por outra instância
de `RunStore` confirmou revisões, pareceres, dependências, orçamento e conteúdo.
O tempo consumido pela preparação permaneceu acumulado. Não houve esclarecimentos
nessas duas entradas, portanto `answerRefs` está vazio; respostas são cobertas nos
testes simulados e não são alegadas como demonstradas aqui.

## Avaliação contra as expectativas anteriores

A inspeção posterior do agente de demonstração encontrou:

| Verificação | Resultado observado |
| --- | --- |
| Casos sem Gherkin | A prosa gerou seis casos concretos, com fontes literais |
| PCE válida | CT-01 usa 5 como inteiro válido interior ao intervalo |
| AVL inclusiva | CT-02/CT-03 usam 1/10, registram a quantidade correta e esperam “Reserva confirmada” |
| Vizinhos inteiros | CT-04/CT-05 usam 0/11, justificam passo unitário, rejeitam sem reserva e esperam “Quantidade inválida” |
| Integralidade | CT-06 usa 5.5 dentro do intervalo para isolar número não inteiro, sem supor arredondamento |
| Exemplo pontual | Um caso para 5 unidades, com disponibilidade, reserva de 5 e mensagem; sem inventar intervalo ou outros resultados |
| Técnica adequada ao exemplo | “Teste baseado em exemplo”, sem forçar PCE/AVL; descrição afirma que 5 não representa classe ou fronteira |
| Percurso e preparação | Todos têm `pathId: null`; condições e preparação futuras, sem telas/botões ou alegação de execução |

As expectativas dos sete casos mantiveram o significado das respectivas fontes.
Essa comparação não usa a aprovação do validador como gabarito. Não foram necessárias
correções nos dois fluxos reais; correção com nova revisão, bloqueios e limites
foram exercitados pelos testes simulados, sem atribuí-los a esta amostra real.

## Validador independente com defeito conhecido

Uma cópia do conjunto da prosa manteve dados, fontes, curadoria, plano, aprovação
e contexto completo; somente `CT-04.expected` foi invertido para registrar reserva
e informar sucesso para quantidade **0**. A cópia recebeu ID próprio e revisão 1,
passou no parser estrutural e foi enviada em sessão independente com
`role: output-validator`, `task: validate-output`. A descrição do erro e este
gabarito ficaram fora do prompt; a execução original não foi alterada.

O parecer real foi **`changes_requested`**, com **`SOURCE_MISMATCH`** em
**`testCases[3].expected`**, citando CT-04, quantidade 0, CA-01/CA-03 e L3. Solicitou
ausência de registro e “Quantidade inválida”, localizando a contradição esperada.
Uma chamada, **7,684 s**, **5.152 tokens**. O ensaio conserva todo o contexto e
não reabre o estudo de remoção de contexto.

Total real: **13 chamadas**, **40.317 tokens**, **168,955 s** na soma das durações
de chamadas. Não é precisão geral nem benchmark de custo. `estimatedCost` é omitido
porque a autenticação é por assinatura; tarifa de API não foi usada como cobrança.
[resultados.json](resultados.json) contém saídas, pareceres e metadados sanitizados;
sem senha, cookie, tokens de autenticação, arquivo de conta ou caminho privado.
Os identificadores publicados pertencem somente a objetos/conta controlados do ensaio.

## Revisão e limites

A pedido explícito do responsável durante a implementação, houve revisões por
agentes, incluindo revisão cruzada do backend. O agente que participou da UI/API
emitiu os pareceres B/C; outro agente revisou o núcleo e apontou um ajuste de
projeção corrigido antes do commit testado. Não se alega independência total de
autoria em toda a revisão. A frente B aprovou integração às **23:11:20 UTC**, após
revisão e 73 testes focados. A frente C, sem autoria das skills ou das saídas reais,
aprovou a metodologia às **23:15:24 UTC**, sem achados:
conferiu os sete casos contra fontes/expectativas, hashes, citações, referências,
dependências, `pathId`, orçamento, intenções e a alteração isolada no ensaio negativo.
O agente responsável pela integração também conferiu os resultados. Esses pareceres são
inspeções de agentes, **não revisão humana**. As menções a revisão humana nas
expectativas prévias permanecem como histórico do protocolo, sem criar um bloqueio
adicional ao fluxo autorizado. CI e merge são consultáveis no
[PR #23](https://github.com/mh131105/akcit-qa-agent/pull/23).

Limitações: uma amostra por material/modelo, domínio pequeno, nenhum alvo acessado,
sem avaliação humana, sem aferição de consistência entre repetições/modelos ou casos
complexos. Não foram executados testes de aplicação. A entrega termina em consulta
e revisão dos casos; aprovação humana do conjunto, mapeamento, navegação, vídeos e
relatório continuam posteriores. Não encerra [T6 #9](https://github.com/mh131105/akcit-qa-agent/issues/9)
nem TELA-06. Evidências anteriores foram preservadas.
