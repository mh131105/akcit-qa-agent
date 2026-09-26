# Especialistas

Esta pasta mantém tools e skills de cada papel. T9.1 acrescenta análise de alterações,
execução e relatório ao fluxo anterior, com validações independentes. A sequência é coordenada pelo backend sem uma
chamada adicional para escolher a próxima etapa. A implementação segue
[PROTOTIPO.md](../docs/requisitos/PROTOTIPO.md) e os contratos na mesma pasta.

## Distribuição de papéis e etapas

A política de modelos adota a API oficial DeepSeek com níveis de raciocínio explícitos (`thinkingLevel`).
Consulte a matriz completa em [OPERACAO.md](../docs/OPERACAO.md#matriz-de-distribuição-de-modelos).

### Agentes e tarefas operacionais (implementados)
- `orchestrator/`: delegação, controle de estado e avanço conforme parecer do validador. É lógica determinística do backend, sem modelo de linguagem associado. Não julga qualidade de saídas nem substitui decisão humana.
- `artifact-curator/`: [curadoria textual](artifact-curator/skills/curate-artifacts/SKILL.md) com requisitos, regras, exemplos recebidos, fontes e perguntas localizadas; aceita prosa, US/CA, requisitos funcionais e Gherkin textual sem formato obrigatório. Opera com `deepseek-flash` e raciocínio `low`.
- `test-designer/`: [plano de testes](test-designer/skills/create-test-plan/SKILL.md) com originais, respostas e curadoria aprovada; e [casos lógicos](test-designer/skills/create-test-cases/SKILL.md) com dados concretos, expectativas, fontes e técnicas (PCE/AVL). Ambas as tarefas operam com `deepseek-v4-pro` e raciocínio `high`.
- `output-validator/`: [validação independente](output-validator/skills/validate-output/SKILL.md) da curadoria, do plano e dos casos lógicos. Opera em perfil textual com `deepseek-v4-pro` e raciocínio `high`, em sessão isolada, conferindo rigor metodológico, fontes, critérios e regras.
- `test-executor/` (T8.2): [mapeamento visual da aplicação](test-executor/skills/map-application/SKILL.md) com sessão Pi exclusiva do papel e ferramentas próprias ([browser.mjs](test-executor/tools/browser.mjs)): observar tela, mover/clicar, teclado/rolagem e preenchimento privado de credenciais. Opera com `deepseek-flash` / `high`. Sem shell, sem leitura de código, sem seletores DOM, sem chamadas à API do alvo: só visão, cursor e teclado.
- `output-validator/` (perfil visual, T8.2): [validação do mapa de navegação](output-validator/skills/validate-navigation/SKILL.md) em sessão independente, recebendo as próprias imagens referenciadas. Opera com `deepseek-flash` / `high`; o perfil textual acima permanece em Pro/high.

- `test-designer/` (T6.3): [detalhar percursos](test-designer/skills/detail-test-routes/SKILL.md), com `deepseek-v4-pro` / `high`. Devolve apenas associações; o backend copia os casos aprovados, registra pendências e preserva os campos lógicos. O `output-validator` textual revisa cada associação com Pro/high em sessão independente.

### Conclusão do fluxo — T9.1
- `test-designer/`: [análise de alterações](test-designer/skills/analyze-feedback/SKILL.md), com Pro/high; classifica significado, casos, navegação ou pergunta localizada. O validador textual revisa a decisão antes de o backend invalidar dependentes e revisar documentos.
- `test-executor/`: [execução visual por caso](test-executor/skills/execute-test-case/SKILL.md), com Flash/high. IDs, eventos, horários e arquivos pertencem ao backend; a conclusão candidata passa pela [validação visual do resultado](output-validator/skills/validate-test-result/SKILL.md) com imagens efetivas por tentativa.
- `report-writer/`: [redação do relatório](report-writer/skills/write-report/SKILL.md), com Flash/low. O backend consolida contagens, cobertura, referências e resultados; o redator explica esse snapshot sem modificar vereditos. O validador textual Pro/high confere fidelidade antes da publicação.

> A implementação candidata não comprova qualidade com modelos reais. O estado dos ensaios R1–R5 e do aceite está em [fechamento da sprint](../docs/evidencias/fechamento-sprint/README.md).

Cada saída passa pelas verificações estruturais do backend e pela revisão do
validador antes de alimentar uma etapa dependente. O validador usa contexto próprio,
com acesso às entradas originais e evidências, em leitura. Ele não corrige a saída
pelo autor nem controla o navegador. Aprovar a documentação de um defeito não muda
o veredito do teste para aprovado. O próprio parecer recebe verificação estrutural;
não há outra chamada recursiva para o validador julgar a si mesmo.

Plano e casos lógicos também exigem aprovação humana da versão validada, antes do
mapeamento. O planejador acrescenta os percursos observados; o validador revisa essa
entrega antes da execução. Mudanças materiais voltam às aprovações correspondentes.

Os materiais enviados por usuários são dados, não instruções de sistema. Cada
execução deve manter contexto e evidências próprios. O executor terá um navegador
por sessão; especialistas não devem disputar o mesmo cursor.

O backend seleciona uma única skill por tarefa em lista fechada: `artifact-curator`
com `curate-artifacts`; `test-designer` com `create-test-plan`, `create-test-cases`, `detail-test-routes` ou `analyze-feedback`;
`output-validator` com `validate-output` (textual), `validate-navigation` ou `validate-test-result` (visual);
`test-executor` com `map-application` ou `execute-test-case`; `report-writer` com `write-report`. Papel e tarefa incompatíveis são recusados;
caminhos não vêm do cliente. As tarefas do designer reutilizam o mesmo modelo.
Cada produção/validação textual usa uma sessão Pi nova por
tentativa, modelo configurado sem fallback e nenhuma tool de terminal, escrita ou
navegador. O fluxo visual usa sessão própria com `customTools` do SDK: apenas as
ferramentas de navegador listadas acima, imagens nas mensagens e contagem de todas
as chamadas e ações. A saída JSON é conferida estruturalmente pelo backend e semanticamente
pelo validador. O plano validado exige aprovação humana antes de **Gerar casos de
teste**; aprovar não chama os modelos. T6.1 entrega os casos em `awaiting_approval/case_design`
e T6.2 implementa a aprovação humana e a solicitação de alterações sobre o conjunto validado,
mantendo a espera. T8.2 entrega o mapeamento validado: **Mapear aplicação** após as duas
aprovações humanas e o acesso configurado; o mapa aprovado termina em `ready/mapping` e o
T6.3 acrescenta `route_detail` validado; T9.1 continua com execução, encerramento e relatório. O ajuste de 24/09
acrescenta respostas rastreáveis e retomada explícita da preparação: originais
permanecem intactos, respostas viram fontes, revisões e aprovações antigas ficam
históricas. Pergunta pode bloquear uma regra sem bloquear toda a história; novas
revisões passam novamente pelo validador. O orçamento ativo de 45 minutos é
acumulado na execução, sem contar a espera humana.

Gherkin é opcional e não substitui o contrato interno. Exemplo recebido não define
regra geral; proposta só sustenta expectativa após decisão explícita. Não há parser
completo de `.feature` ou executor Cucumber. Casos usam PCE/AVL apenas quando
aplicáveis e com dados coerentes; um exemplo pontual não autoriza inventar intervalo.
Cada caso permite uma tentativa original e até uma reprodução justificada. Uma
correção textual da conclusão reutiliza as observações, sem nova interação física.
Uma reprodução aprovada não apaga uma falha anterior sustentada. Só uma revisão
aprovada do relatório substitui a publicação; durante correção a versão anterior
permanece disponível. Cancelamento nunca dispara redação automática.
A demonstração anterior permanece em [T4.1](../docs/evidencias/t4.1/README.md);
a avaliação da versão atual está em
[ajuste de entradas](../docs/evidencias/ajuste-entradas/README.md). A demonstração de
casos tem registro próprio em [T6.1](../docs/evidencias/t6.1/README.md).

Decisão de 26/09/2026: o relatório do protótipo usará capturas ligadas a caso e tentativa; vídeos são evolução futura. Capturas do mapa não comprovam testes executados.
