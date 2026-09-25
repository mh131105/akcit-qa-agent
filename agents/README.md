# Especialistas

Esta pasta mantém tools e skills de cada papel. T4.1 implementa curadoria/plano;
T6.1 acrescenta casos lógicos, com validações independentes. A sequência é coordenada pelo backend sem uma
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

### Agentes e etapas planejadas (futuras)
- `test-designer/` (em `route_detail`): associará percursos observados no mapa aos casos aprovados, operando com `deepseek-v4-pro` / `high`, preservando integralmente os campos já validados e aprovados.
- `test-executor/`: reconhecimento de telas, navegação, mouse, teclado e registro de evidências. Planejado para operar com `deepseek-flash` / `high` tanto no mapeamento quanto na execução, utilizando capacidade multimodal de imagens.
- `report-writer/`: consolidação de resultados validados e referências a evidências em relatório textual, operando com `deepseek-flash` / `low`. Novas interpretações de comportamento não pertencem ao redator e devem retornar às etapas técnicas correspondentes.
- `output-validator/` (perfil visual): revisão independente do mapa e dos resultados apoiados em capturas visuais, operando com `deepseek-flash` / `high`.

> **Ressalva factual:** A execução existente comprova a integração técnica da preparação textual; ainda não comprova a qualidade do navegador, do relatório ou da validação visual, nem superioridade entre modelos.

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
com `curate-artifacts`; `test-designer` com `create-test-plan` ou `create-test-cases`;
`output-validator` com `validate-output`. Papel e tarefa incompatíveis são recusados;
caminhos não vêm do cliente. As duas tarefas do designer reutilizam o mesmo modelo.
Cada produção/validação usa uma sessão Pi nova por
tentativa, modelo configurado sem fallback e nenhuma tool de terminal, escrita ou
navegador. A saída JSON é conferida estruturalmente pelo backend e semanticamente
pelo validador. O plano validado exige aprovação humana antes de **Gerar casos de
teste**; aprovar não chama os modelos. T6.1 termina em `awaiting_approval/case_design`,
com casos consultáveis. A aprovação humana dos casos ainda será integrada. O ajuste de 24/09
acrescenta respostas rastreáveis e retomada explícita da preparação: originais
permanecem intactos, respostas viram fontes, revisões e aprovações antigas ficam
históricas. Pergunta pode bloquear uma regra sem bloquear toda a história; novas
revisões passam novamente pelo validador. O orçamento ativo de 45 minutos é
acumulado na execução, sem contar a espera humana.

Gherkin é opcional e não substitui o contrato interno. Exemplo recebido não define
regra geral; proposta só sustenta expectativa após decisão explícita. Não há parser
completo de `.feature` ou executor Cucumber. Casos usam PCE/AVL apenas quando
aplicáveis e com dados coerentes; um exemplo pontual não autoriza inventar intervalo.
Mapeamento, execução e relatório aguardam as respectivas entregas.
A demonstração anterior permanece em [T4.1](../docs/evidencias/t4.1/README.md);
a avaliação da versão atual está em
[ajuste de entradas](../docs/evidencias/ajuste-entradas/README.md). A demonstração de
casos tem registro próprio em [T6.1](../docs/evidencias/t6.1/README.md).
