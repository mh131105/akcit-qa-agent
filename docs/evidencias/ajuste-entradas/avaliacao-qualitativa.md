# Avaliação independente das saídas das skills

Avaliação feita contra o material de entrada e as expectativas de cada `eval_metadata.json`, lendo os `outputs/result.json`. Os pareceres do `output-validator` foram avaliados como saídas do experimento; não foram usados como gabarito da própria avaliação. Não houve nova chamada de modelo nesta graduação. Os arquivos individuais foram comparados com `results.json` e correspondem ao registro agregado.

Foram produzidos 20 arquivos `grading.json`: uma expectativa composta por cenário, dez cenários por variante. A amostra utiliza material fictício, um único modelo (`openai-codex/gpt-6-astra`) e uma execução por combinação. A variante `old_skill` é a skill anterior, não ausência de skill.

## Resultado observado

| Cenário | Skill anterior | Skill revisada | Interpretação |
|---|---|---|---|
| Prosa completa | Passou | Passou | Ambas preservaram limites, condições, acréscimo de prazo e recusa. |
| Gherkin com Contexto | Passou | Passou | A anterior preservou o cenário e a autenticação em CA-04; a nova os separou em `examples`. A diferença de estrutura não é perda semântica na anterior. |
| RF sem US | Passou | Passou | Ambas aceitaram RF sem exigir persona ou rótulo US e mantiveram a fronteira inclusiva. |
| História vaga | Falhou | Passou | A anterior pediu genericamente critérios/regras. A nova perguntou condições de aplicação e resultado no preço. Nenhuma inventou percentuais. |
| Fontes em conflito | Passou | Passou | Ambas preservaram as duas versões e pediram uma decisão. |
| Exemplo isolado | Falhou no contrato | Passou | Ambas mantiveram FESTA, 200→180, sem inferir desconto geral. Apenas a nova entregou `kind=example`, exigido pela expectativa. |
| Bloqueio parcial | Falhou | Passou | A anterior descreveu a intenção de não bloquear a nota, mas seu vínculo estruturado bloqueia a US inteira. A nova vinculou a dúvida somente à sub-regra do limite. |
| Plano conciso | Passou | Passou | Ambos cobrem as regras sem percurso inventado nem casos detalhados. A nova abordagem tem três itens; a anterior, quatro. |
| Validar plano correto | Passou | Passou | Ambas aprovaram o plano correto sem exigir nomes de agentes ou recitação das validações. |
| Rejeitar limite adulterado | Passou | Passou | Ambas identificaram a troca indevida de 10 por 11 e solicitaram correção. |

Contagem das expectativas predefinidas: **7/10 na anterior e 10/10 na revisada**. Essa contagem não equivale a uma taxa geral de precisão. Em particular, a falha em `exemplo-isolado` é de classificação explícita, não de fidelidade semântica. Não foi observada uma regressão semântica material nas saídas inspecionadas, dentro destas expectativas.

## Diferenças materiais e ressalvas

- O ganho funcional mais claro é o **bloqueio localizado**. Na variante anterior, `blocking=true`, `requirementIds=[US-01]` e ausência de `ruleIds` fazem a elegibilidade bloquear toda a história. Na revisada, a pergunta aponta apenas para CA-03, mantendo CA-01 (nota) e CA-02 (opcionalidade) disponíveis. O ganho depende também do contrato e do código de elegibilidade novos; não deve ser atribuído exclusivamente à redação da skill.
- A pergunta revisada para descontos é mais acionável. A anterior continua segura ao não inventar regra, mas devolve ao usuário o trabalho genérico de elaborar todos os critérios. A expectativa composta reprova essa falta de orientação concreta.
- **O problema histórico de rejeitar um plano por não recitar o workflow não se reproduziu no baseline desta amostra.** Ambos aprovaram o mesmo plano correto. A rodada comprova o comportamento observado agora, mas não quantifica redução de falsos positivos.
- O plano revisado pede “Item disponível” e “Meio de consultar as reservas e seus comentários” como pré-condições. São necessidades operacionais plausíveis, não demonstrações de que esses recursos ou telas já foram observados. A variante anterior deixa mais explícito que acesso e meios de observação serão providenciados antes de mapeamento/execução. Convém manter essa distinção clara na apresentação para não transformar uma preparação futura em impedimento ao planejamento.
- Os formatos em prosa e Gherkin desta amostra compartilham a regra de renovação, mas o Gherkin adiciona explicitamente autenticação e um cenário concreto. Equivalência deve comparar os comportamentos comuns e preservar a informação adicional, não exigir JSON idêntico.

## Consumo registrado

Os valores abaixo somam `metadata.durationMs` e `metadata.usage`; não medem a latência ponta a ponta de um produto, porque as chamadas do experimento foram executadas separadamente e podem se sobrepor.

| Métrica, 10 chamadas por variante | Anterior | Revisada | Diferença |
|---|---:|---:|---:|
| Tokens de entrada | 13.250 | 17.724 | +4.474 |
| Tokens de saída | 3.735 | 3.962 | +227 |
| Tokens totais | 16.985 | 21.686 | +4.701 (+27,7%) |
| Soma das durações | 140,246 s | 146,660 s | +6,414 s (+4,6%) |
| Mediana por chamada | 14,732 s | 15,924 s | +1,192 s |

Não há `estimatedCost` nesses registros. Portanto não há base para publicar diferença monetária. A versão revisada consumiu mais tokens nesta rodada; não se deve anunciar economia ou melhoria de velocidade geral a partir deste experimento. Uma só observação por combinação não separa variação de latência do efeito das instruções.

## Limitações e próximos casos úteis

- Não há repetição estatística, avaliação cega por vários humanos, outros modelos, backlogs extensos ou documentação de clientes reais.
- O experimento avalia chamadas isoladas. Não demonstra sozinho a qualidade do ciclo completo de perguntas, resposta humana, retomada, validação e aprovação. Os testes automatizados do backend verificam esse ciclo com modelos substitutos, mas isso é evidência diferente.
- As expectativas compostas deveriam ser separadas em fidelidade semântica, classificação do conteúdo, utilidade das perguntas e efeito operacional do bloqueio. Isso evita que uma falha de campo novo pareça uma alucinação.
- Acrescentar avaliações com mais de um requisito independente; múltiplos Contextos/cenários; Scenario Outline/Examples; unidades e datas; exceções negativas; parâmetros faltantes; conteúdo contraditório após resposta do usuário; e instruções indevidas embutidas nos artefatos.
- Acrescentar alterações deliberadas além de um limite: pré-condição omitida, comentário opcional tornado obrigatório, exemplo generalizado, fonte citada que não sustenta a afirmação e pergunta que bloqueia escopo não relacionado.
- Medir se respostas humanas efetivamente encerram perguntas resolvidas, preservam conflitos ainda abertos e não reapresentam desnecessariamente a mesma pergunta na revisão seguinte.
