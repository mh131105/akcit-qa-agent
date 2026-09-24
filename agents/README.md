# Especialistas

Esta pasta mantém tools e skills de cada papel. T4.1 implementa curadoria, plano e
as duas validações independentes; a sequência é coordenada pelo backend sem uma
chamada adicional para escolher a próxima etapa. A implementação segue
[PROTOTIPO.md](../docs/requisitos/PROTOTIPO.md) e os contratos na mesma pasta.

- `orchestrator/`: delegação, estado da sessão e encaminhamento conforme o parecer
  do validador; não avalia a qualidade das saídas nem substitui uma decisão dele.
- `artifact-curator/`: [curadoria textual](artifact-curator/skills/curate-artifacts/SKILL.md)
  com requisitos, regras, exemplos recebidos, fontes e perguntas localizadas;
  aceita prosa, US/CA, requisitos funcionais e Gherkin textual sem formato obrigatório.
- `test-designer/`: [plano de testes](test-designer/skills/create-test-plan/SKILL.md)
  com originais, respostas e curadoria aprovada; produz cobertura concisa, sem
  recitar as etapas internas. A etapa futura de casos elaborará cenários mesmo
  quando o cliente não fornecer Gherkin; casos e detalhamento permanecem pendentes.
- `test-executor/`: reconhecimento de navegação, mouse, teclado e evidências.
- `report-writer/`: consolidação de resultados e referências às evidências.
- `output-validator/`: [validação independente](output-validator/skills/validate-output/SKILL.md)
  da curadoria e do plano, distinguindo erros materiais de paráfrases e escolhas de
  redação. Demais fases permanecem pendentes. Aprova, pede correção
  ou bloqueia com justificativa; falhas técnicas são registradas pelo backend.

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

T4.1 carrega explicitamente a skill de cada tarefa, usa uma sessão Pi nova por
tentativa, modelo configurado sem fallback e nenhuma tool de terminal, escrita ou
navegador. A saída JSON é conferida estruturalmente pelo backend e semanticamente
pelo validador. O fluxo termina na revisão humana do plano. O ajuste de 24/09
acrescenta respostas rastreáveis e retomada explícita da preparação: originais
permanecem intactos, respostas viram fontes, revisões e aprovações antigas ficam
históricas. Pergunta pode bloquear uma regra sem bloquear toda a história; novas
revisões passam novamente pelo validador. O orçamento ativo de 45 minutos é
acumulado na execução, sem contar a espera humana.

Gherkin é opcional e não substitui o contrato interno. Exemplo recebido não define
regra geral; proposta só sustenta expectativa após decisão explícita. Não há parser
completo de `.feature`, executor Cucumber ou nova geração de casos neste ajuste.
Criação de casos, mapeamento, execução e relatório aguardam as respectivas entregas.
A demonstração anterior permanece em [T4.1](../docs/evidencias/t4.1/README.md);
a avaliação da versão atual está em
[ajuste de entradas](../docs/evidencias/ajuste-entradas/README.md).
