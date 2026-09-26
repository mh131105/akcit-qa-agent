# Entradas flexíveis, esclarecimentos e revisão das skills

24/09/2026 · alteração no mesmo [PR #22](https://github.com/mh131105/akcit-qa-agent/pull/22), sobre `638ab7d`.
Revisão humana e merge continuam pendentes. A demonstração anterior em
[T4.1](../t4.1/README.md) permanece como registro histórico das skills antigas.

## Decisão e comportamento implementado

O usuário pode colar US/CA, requisitos funcionais, prosa, Gherkin textual ou exemplos.
O contrato interno continua sendo requisitos, regras, exemplos recebidos e perguntas.
Gherkin é opcional; não há parser completo de `.feature`, Cucumber nem geração de
casos implementada neste recorte. A entrada mínima para **planejar** é comportamento
esperado verificável; material insuficiente pode ser recebido e esclarecido.

As três skills preservam significado e fontes, distinguem regra de exemplo e
orientam perguntas concretas. O bloqueio pode atingir somente uma regra. O plano
explica cobertura e limitações; não precisa recitar os agentes e aprovações internas.
As decisões normativas estão em [PROTOTIPO.md](../../requisitos/PROTOTIPO.md) e os
dados/transições em [CONTRATOS.md](../../requisitos/CONTRATOS.md).

Na interface, o entendimento normalizado pode ser expandido. O usuário registra
uma resposta por pergunta/revisão e clica em **Retomar preparação com as respostas**.
O backend mantém os originais, acrescenta a resposta como fonte e invalida o avanço
pelo plano antigo imediatamente. A retomada refaz curadoria/plano com validação
independente e revisões crescentes; exige nova aprovação humana. Não inicia casos.
O tempo ativo anterior permanece no limite cumulativo de 45 minutos.

## Comparação com inferência real

Foram executadas **20 chamadas reais**, uma por cenário/variante, com Pi 0.87.0,
Node 24.19.0 e `openai-codex/gpt-6-astra`. Credencial OAuth privada do projeto.
O mesmo runtime e modelo foram usados nas duas variantes; skills anteriores vêm
de `638ab7d`. Hashes das skills/runtime, entradas exatas, saídas e consumo estão em
[comparacao-skills.json](comparacao-skills.json).

Sete entradas de curadoria: prosa completa, Gherkin com contexto, RF sem US formal,
história vaga, fontes em conflito, exemplo isolado e bloqueio parcial. Mais três
tarefas: elaborar plano, validar plano correto e detectar limite adulterado.
Gabaritos, nomes de cenários da avaliação e expectativas ficaram fora dos prompts.
As notas humanas sobre material fictício também não foram enviadas como requisitos.

A avaliação por agente independente comparou fontes e saídas, sem usar os pareceres
do validador como gabarito. Não substitui a revisão humana da frente C.

| Observação | Anterior | Revisada |
| --- | --- | --- |
| Estrutura e fontes literais aceitas pelo parser | 10/10 | 10/10 |
| Expectativas compostas atendidas nesta amostra | 7/10 | 10/10 |
| Tokens totais | 16.985 | 21.686 |
| Soma das durações das chamadas | 140,246 s | 146,660 s |

A contagem não representa precisão geral: inclui o campo novo `kind=example`,
ausente no contrato antigo. As duas versões preservaram o significado do exemplo
200→180 e do Gherkin, aprovaram o plano correto e detectaram o limite adulterado.
O ganho operacional mais claro foi manter a nota elegível enquanto a dúvida
bloqueia somente o limite do comentário. A pergunta sobre descontos ficou mais útil.
Detalhes e julgamento de cada cenário: [avaliação qualitativa](avaliacao-qualitativa.md).

A revisada consumiu **27,7% mais tokens** e somou **4,6% mais duração**; as chamadas
dos dois braços podem se sobrepor. Não é latência ponta a ponta nem demonstração
de economia. Custo em moeda não foi inferido a partir da tarifa de API, pois a
autenticação usa assinatura. Uma execução por cenário não mede repetibilidade.

## Jornada real pelo site

Uma execução nova recebeu apenas a US de avaliação, nota inteira de 1 a 5 e comentário
opcional com limite a definir. O rascunho foi criado pela API; início, resposta e
retomada foram acionados no site, com o coordenador e os modelos reais.

1. A curadoria separou nota, opcionalidade e limite pendente. O plano r1 cobriu as
   regras claras e apresentou Q-01, bloqueando apenas o limite.
2. A resposta definiu no máximo 500 pontos de código Unicode e, em excesso, recusa
   integral sem salvar, com a mensagem “Comentário muito longo”. A interface
   preservou o comentário de revisão digitado e retirou o botão de aprovação antiga.
3. A retomada incorporou a resposta com fonte própria. Curadoria r2 e plano r3
   foram aprovados pelo validador. O comentário antigo ficou disponível para cópia,
   sem preencher o formulário da nova revisão.

Resultado: **10 chamadas, 31.061 tokens e 144,113 s ativos**, dois ciclos,
nenhuma pergunta restante e `awaiting_approval/planning`. **Zero decisões humanas**;
o botão de aprovação final não foi acionado. [Registro sanitizado](jornada-real.json)
e [captura do plano](plano-retomado.png) contêm somente dados sintéticos.

**Limitação encontrada:** o validador aprovou r1 sem cobertura de notas não numéricas
e rejeitou r2 por excluir essa classe. A resposta sobre comentário não alterou a
regra da nota. A inclusão em r3 é defensável pela exigência de número inteiro, mas
a diferença de julgamento revela uma omissão inicial de cobertura. A comparação
de chamadas isoladas acima não reproduziu nem mede essa inconsistência. O problema
histórico de exigir recitação do workflow também não se reproduziu no baseline;
não há redução de falsos positivos comprovada por esta amostra.

A jornada rodou durante a implementação. Os últimos ajustes técnicos de limites
persistidos/metadados foram conferidos depois pelos testes automatizados; o registro
identifica essa distinção, sem atribuir à jornada a validação da imagem final.

## Verificação e reprodução

- Node 24: typecheck, **96/96 testes** e build aprovados; seis testes operacionais
  Python aprovados. Testes automatizados substituem explicitamente os modelos.
- Novas verificações cobrem escopo de dúvidas, exemplos/fontes, resposta idempotente,
  conflitos, propriedade, revisão antiga, falha de preflight, reserva concorrente,
  cancelamento, reinício, orçamento cumulativo e três produções por ciclo.
- O smoke web existente ganhou resposta/retomada, conflito entre abas, preservação
  de textos e nova aprovação. Sua execução na imagem final integra a CI do PR;
  a checagem de sintaxe local não é apresentada como execução desse smoke.

Para repetir as chamadas reais, configure privadamente o Pi conforme
[OPERACAO.md](../../OPERACAO.md), use Node 24 e execute na raiz:

```sh
npm run build
node --env-file=.env scripts/eval-preparation-skills.mjs --run
```

O comando faz 20 inferências e grava em `.data/skills-eval-<timestamp>/`, sem mudar
execuções, aprovações ou skills do checkout. Os exemplos ficam em
`test/fixtures/preparation-inputs.json`; somente `text` entra no material do modelo.
As expectativas ficam separadas e devem ser avaliadas contra as fontes depois das
chamadas. Não usar documentos de clientes para publicar evidências.

Faltam revisão humana de qualidade, testes com documentação real, repetição em
outros domínios/modelos e cenários Gherkin complexos. Este ajuste não encerra T4,
T5, T6 ou T10, nem implementa upload, casos, navegação ou relatório de execução.
