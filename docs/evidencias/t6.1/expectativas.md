# Expectativas definidas antes das inferências

Preparadas em 24/09/2026, antes da execução das chamadas reais de T6.1.
Este documento e os nomes dos cenários de avaliação ficam fora dos prompts.
Somente o texto integral de cada entrada publicada alimenta a execução respectiva.
URL, credenciais, telas, botões e percursos não serão fornecidos nem simulados.

## Regra em prosa

- A ausência de Gherkin não impede curadoria, plano e casos lógicos.
- O escopo preserva quantidade **inteira**, intervalo inclusivo **1 a 10**, reserva
  com a quantidade solicitada quando válida e ausência de reserva quando inválida.
- Os casos incluem 0 e 11 com "Quantidade inválida" e sem reserva; 1 e 10 com
  "Reserva confirmada" e reserva da quantidade solicitada.
- PCE identifica as classes válidas e inválidas exercitadas; AVL justifica os
  vizinhos inteiros de passo 1. Um valor fracionário deve exercitar a restrição de
  integralidade, sem confundi-la com o intervalo. Não se exige PCE/AVL em todo caso.
- Dados e expectativas são verificáveis e sustentados por citações literais.

## Exemplo pontual em Gherkin

- A curadoria conserva o exemplo de 5 unidades com a condição de disponibilidade.
- O plano e os casos ficam no comportamento demonstrado: registrar 5 unidades e
  informar "Reserva confirmada".
- Não se inventam mínimos, máximos, intervalo permitido, classes inválidas ou
  resultados para outras quantidades. PCE/AVL não são obrigatórias nem justificadas
  artificialmente. Uma abordagem baseada no exemplo recebido é adequada.

## Fluxo e rastreabilidade em ambas as entradas

- Curadoria e plano têm pareceres aprovados. Uma aprovação da revisão exata do
  plano é registrada pela API autenticada para habilitar a demonstração. É ação
  automatizada autorizada para dados controlados, **não revisão humana da frente C**.
- A continuidade faz chamadas reais do gerador e do validador em sessões separadas.
- Casos referenciam apenas requisitos/regras do plano, preservam dependências de
  revisões, fontes e `pathId: null`. Pré-condições/preparação são instruções futuras,
  nunca alegações de ação executada.
- O resultado esperado é `awaiting_approval/case_design`, parecer aprovado, conjunto
  consultável e intenção encerrada. Repetição da continuidade não cria chamadas.
- O consumo anterior permanece acumulado. Uma releitura independente do
  armazenamento confirma saídas, pareceres e histórico.

## Ensaio independente do validador

Uma cópia dos casos reais da prosa terá **somente uma expectativa materialmente
adulterada**: para 0 (ou outro valor inválido real), informar que a reserva é
registrada e aceita. Fontes, dados, originais, curadoria, plano e revisão da saída
permanecem disponíveis. Se o conjunto não contiver valor inválido, usar um caso
válido real e inverter sua expectativa para rejeição.

O validador não receberá a descrição da adulteração, este gabarito nem resultados
simulados. Espera-se `changes_requested` ou `blocked`, com achado que localize o caso
e a contradição. O parecer efetivo será publicado, inclusive se houver falsa
aprovação. O ensaio não altera a execução real nem reabre remoção de contexto.

## Forma de avaliação

Comparar cada saída com estas expectativas e com as fontes após as chamadas.
Registrar revisões, correções, achados, duração e consumo disponíveis, sem tratar
parecer aprovado como prova suficiente de qualidade. A avaliação do agente e os
testes automatizados não substituem a revisão humana metodológica da frente C ou
a revisão de integração da frente B. Uma amostra por entrada não mede consistência
geral, cobertura de outros domínios, navegação ou execução de testes.
