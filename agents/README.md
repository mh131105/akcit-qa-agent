# Especialistas

Esta pasta reserva os pontos de extensão do orquestrador e dos cinco especialistas.
Cada papel terá tools e skills próprias. A preparação do ambiente não implementa a
metodologia. A implementação segue [PROTOTIPO.md](../docs/requisitos/PROTOTIPO.md)
e os contratos de integração na mesma pasta.

- `orchestrator/`: delegação, estado da sessão e encaminhamento conforme o parecer
  do validador; não avalia a qualidade das saídas nem substitui uma decisão dele.
- `artifact-curator/`: curadoria de backlog, histórias e requisitos.
- `test-designer/`: plano, casos lógicos com PCE/AVL e detalhamento dos percursos após o mapa.
- `test-executor/`: reconhecimento de navegação, mouse, teclado e evidências.
- `report-writer/`: consolidação de resultados e referências às evidências.
- `output-validator/`: validação independente da curadoria, plano, casos, mapa,
  detalhamento, resultados e relatório. Aprova, pede correção ou bloqueia com justificativa.

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

As tools padrão de terminal e escrita do Pi ficam desabilitadas na fábrica inicial.
A implementação futura registrará apenas as tools necessárias a cada papel.
