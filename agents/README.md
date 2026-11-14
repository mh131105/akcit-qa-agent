# Agentes e coordenação

O QAtron combina um orquestrador determinístico no backend com cinco papéis de agentes. O orquestrador controla estados, encaminha tarefas e aplica os pareceres; a escolha da próxima etapa não exige outra chamada de modelo.

A especificação está em [Produto](../docs/requisitos/PROTOTIPO.md), os formatos de dados em [Contratos](../docs/requisitos/CONTRATOS.md) e a configuração em [Operação](../docs/OPERACAO.md#matriz-de-distribuição-de-modelos).

## Papéis e tarefas

| Papel | Responsabilidades | Perfil atual |
| --- | --- | --- |
| Curador — `artifact-curator/` | [Organizar requisitos, regras e fontes](artifact-curator/skills/curate-artifacts/SKILL.md), preservando os originais e formulando perguntas quando necessário. | `deepseek-flash`, `low` |
| Projetista — `test-designer/` | Criar [planos](test-designer/skills/create-test-plan/SKILL.md) e [casos](test-designer/skills/create-test-cases/SKILL.md), [associar percursos](test-designer/skills/detail-test-routes/SKILL.md) e [analisar alterações](test-designer/skills/analyze-feedback/SKILL.md). | `deepseek-v4-pro`, `high` |
| Executor — `test-executor/` | [Mapear a aplicação](test-executor/skills/map-application/SKILL.md) e [executar casos](test-executor/skills/execute-test-case/SKILL.md) pela interface visual. | `deepseek-flash`, `high` |
| Validador — `output-validator/` | Revisar [saídas textuais](output-validator/skills/validate-output/SKILL.md), [mapas de navegação](output-validator/skills/validate-navigation/SKILL.md) e [resultados dos testes](output-validator/skills/validate-test-result/SKILL.md) em sessões independentes. | Textual: `deepseek-v4-pro`, `high`; visual: `deepseek-flash`, `high` |
| Redator — `report-writer/` | [Explicar os resultados no relatório](report-writer/skills/write-report/SKILL.md), usando as contagens, conclusões e evidências consolidadas pelo backend. | `deepseek-flash`, `low` |

Os perfis usam a API oficial DeepSeek, com nível de raciocínio explícito em `thinkingLevel`. A configuração é definida por ambiente, sem fallback silencioso. O orquestrador não tem um modelo de linguagem associado.

## Fluxo de trabalho

1. O curador organiza as entradas. O projetista prepara o plano. As duas saídas passam pelo validador.
2. O usuário aprova a versão validada do plano antes de solicitar os casos.
3. O projetista cria os casos; o validador revisa e o usuário aprova o conjunto.
4. Com o acesso ao alvo configurado, o executor observa a aplicação. O validador visual confere o mapa e suas capturas.
5. O projetista associa os percursos observados aos casos aprovados. O backend preserva os campos lógicos e registra pendências; o validador revisa as associações.
6. O executor realiza os casos com percursos elegíveis. O validador visual confronta cada conclusão com as observações e imagens da tentativa.
7. O backend consolida os resultados. O redator produz o relatório e o validador textual confere sua fidelidade antes da publicação.

Aprovar o plano ou os casos registra uma decisão; a aprovação, sozinha, não chama modelos. Mudanças materiais voltam às aprovações correspondentes.

## Sessões e ferramentas

Cada produção ou validação textual utiliza uma sessão Pi nova por tentativa. Os papéis textuais não recebem ferramentas de terminal, escrita ou navegador. O backend seleciona uma skill por tarefa em uma lista fechada e recusa combinações incompatíveis de papel e tarefa.

O executor utiliza as [ferramentas de navegador](test-executor/tools/browser.mjs) para observar a tela, mover o cursor, clicar, digitar, rolar e preencher credenciais por um mecanismo privado. Os agentes não consultam código, seletores DOM ou APIs da aplicação-alvo, nem recebem uma ferramenta de shell.

O fluxo visual tem sessão própria e ferramentas registradas por `customTools` no SDK. Imagens, ações e chamadas são contabilizadas. Cada execução mantém seu contexto e suas evidências; os especialistas não disputam o mesmo cursor.

O validador recebe os originais e as evidências em contexto independente. Ele revisa a saída, mas não a reescreve pelo autor nem controla o navegador. O backend confere a estrutura do parecer; não há uma chamada recursiva para o validador julgar a si mesmo. Validar o registro de uma falha não transforma o teste em aprovado.

## Requisitos, perguntas e alterações

A curadoria aceita prosa, histórias de usuário, critérios de aceite, requisitos funcionais e Gherkin textual. Não há exigência de formato único, parser completo de arquivos `.feature` ou executor Cucumber.

Casos aplicam particionamento em classes de equivalência e análise de valores-limite quando os requisitos sustentam essas técnicas. Um exemplo recebido não autoriza inventar uma regra geral ou intervalo.

As entradas dos usuários são dados, não instruções de sistema. Os originais permanecem preservados; respostas a perguntas viram fontes rastreáveis. A análise de alterações identifica os itens afetados antes de invalidar saídas dependentes. Novas revisões passam pelo validador e mantêm o histórico das decisões anteriores.

## Tentativas e relatório

Cada caso permite uma tentativa original e até uma reprodução justificada. Uma correção textual da conclusão reutiliza as observações, sem nova interação física. Uma reprodução aprovada não apaga uma falha anterior sustentada.

O backend mantém IDs, eventos, horários, arquivos, contagens e cobertura. As capturas do relatório pertencem a casos e tentativas identificados; uma captura do mapa, por si só, não comprova a execução de um teste.

O redator explica os resultados consolidados sem modificar os vereditos. Somente uma revisão aprovada substitui o relatório publicado; durante uma correção, a versão anterior permanece disponível. Cancelamento não inicia redação automática. O limite de tempo ativo da execução é de 45 minutos, excluindo a espera humana.

## Verificação e evidências

Os registros de [validação integrada](../docs/evidencias/fechamento-sprint/README.md) e de [avaliação dos prompts](../docs/evidencias/ajuste-entradas/README.md) documentam verificações realizadas e seus limites. Testes com modelos substituídos validam o comportamento do pipeline; sua aprovação não comprova, sozinha, a qualidade das respostas dos modelos reais.
